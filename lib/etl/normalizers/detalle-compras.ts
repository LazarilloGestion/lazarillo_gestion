import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import type { DbClient, ETLContext } from "../types";
import { trim, toDecimalStr, excelDateToISO } from "../helpers";
import { linkDetalleComprasByComprobante } from "../normalizer-utils";
import type { ETLRow, ETLRowError, ETLSkippedRow } from "../types";
import { detalleCompraRowSchema, type DetalleCompraRow } from "../schemas/detalle-compras";
import { formatZodError } from "../schemas/common";

const CHUNK_SIZE = 500;

function makeComprobante(r: ETLRow): string | null {
  const cpb  = String(r["COD_CPB"] ?? "").trim();
  const num1 = String(r["NUMERO1"] ?? "").trim().padStart(4, "0");
  const num2 = String(r["NUMERO2"] ?? "").trim().padStart(8, "0");
  if (!cpb) return null;
  return `${cpb}${num1.padStart(4, "0")}${num2.padStart(8, "0")}`;
}

// makeRowId opera siempre sobre la fila cruda — el hash tiene que ser estable
// entre reimports del mismo archivo.
function makeRowId(r: ETLRow): string {
  // El ERP no exporta número de línea — CANTIDAD+NETO son los únicos
  // diferenciadores cuando el mismo artículo aparece dos veces en la misma factura.
  const key = [r["COD_CPB"], r["NUMERO1"], r["NUMERO2"], r["CODIGO"], r["CANTIDAD"], r["NETO"]]
    .map((v) => String(v ?? ""))
    .join("|");
  return createHash("sha256").update(key).digest("hex").substring(0, 24);
}

function formatFecha(val: unknown): string | undefined {
  const iso = excelDateToISO(val);
  if (!iso) return undefined;
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export async function normalizeDetalleCompras(
  rows: ETLRow[],
  prisma: DbClient,
  ctx?: ETLContext
): Promise<{ created: number; updated: number; skipped: number; skippedRows: ETLSkippedRow[]; errors: ETLRowError[] }> {
  const skippedRows: ETLSkippedRow[] = [];
  const errors: ETLRowError[] = [];

  type ParsedRow = { rowId: string; row: ETLRow; data: DetalleCompraRow };
  const parsedRows: ParsedRow[] = [];

  rows.forEach((r, idx) => {
    if (trim(r["COD_CPB"]) == null || trim(r["CODIGO"]) == null) {
      skippedRows.push({
        fecha: formatFecha(r["FECHA"]),
        concepto: trim(r["CODIGO"]) ?? trim(r["NOMBRE"]) ?? undefined,
        importe: toDecimalStr(r["NETO"]) ?? toDecimalStr(r["TOTALINS"]) ?? undefined,
        proveedor: trim(r["COD_PRO"]) ?? undefined,
        motivo: "sin_datos",
      });
      return;
    }
    const parsed = detalleCompraRowSchema.safeParse(r);
    if (!parsed.success) {
      errors.push({ rowIndex: idx, rawCodigo: r["CODIGO"], message: formatZodError(parsed.error) });
      return;
    }
    parsedRows.push({ rowId: makeRowId(r), row: r, data: parsed.data });
  });

  // Dedup por rowId — last-wins, pero ahora la fila que se pisa se reporta en
  // skippedRows con motivo "duplicado" en vez de perderse en silencio.
  const rowIdMap = new Map<string, ParsedRow>();
  for (const pr of parsedRows) {
    const prev = rowIdMap.get(pr.rowId);
    if (prev) {
      skippedRows.push({
        fecha: formatFecha(prev.row["FECHA"]),
        concepto: trim(prev.row["CODIGO"]) ?? trim(prev.row["NOMBRE"]) ?? undefined,
        importe: toDecimalStr(prev.row["NETO"]) ?? toDecimalStr(prev.row["TOTALINS"]) ?? undefined,
        proveedor: trim(prev.row["COD_PRO"]) ?? undefined,
        motivo: "duplicado",
      });
    }
    rowIdMap.set(pr.rowId, pr);
  }
  const filtered = Array.from(rowIdMap.values());
  const skipped = skippedRows.length;

  const codigosArt = [...new Set(filtered.map((pr) => pr.data.CODIGO).filter((v): v is string => v != null))];
  const artSet = new Set(
    (await prisma.articulo.findMany({
      where: { codigo: { in: codigosArt } },
      select: { codigo: true },
    })).map((a) => a.codigo)
  );

  let created = 0;
  let updated = 0;

  for (let i = 0; i < filtered.length; i += CHUNK_SIZE) {
    const chunk = filtered.slice(i, i + CHUNK_SIZE);
    const chunkRowIds = chunk.map((pr) => pr.rowId);

    const existingSet = new Set(
      (await prisma.detalleCompra.findMany({
        where: { rowId: { in: chunkRowIds } },
        select: { rowId: true },
      })).map((d) => d.rowId)
    );

    try {
      const localId = ctx?.localId ?? null;

      const rowValues = chunk.map(({ rowId, row, data }) => {
        const articuloCodigo = artSet.has(data.CODIGO) ? data.CODIGO : null;
        // proveedorId nunca se resuelve acá de forma independiente: esta tabla no
        // tiene un campo de texto de proveedor contra el cual validar el CODIGO
        // (a diferencia de compras.ts) — ver spec 2026-09-19-cruce-proveedorid-compras-design.md §3.3.
        const proveedorId = null;
        return Prisma.sql`(
          ${rowId},
          ${data.COD_PRO},
          ${data.COD_CPB},
          ${data.NUMERO1},
          ${data.NUMERO2},
          ${makeComprobante(row)},
          ${data.FECHA},
          ${data.CODIGO},
          ${data.NOMBRE},
          ${data.MEDIDA},
          ${data.CANTIDAD}::numeric,
          ${data.NETO}::numeric,
          ${data.TOTALINS}::numeric,
          ${data.IVATOT}::numeric,
          ${data.IMPINTTOT}::numeric,
          ${data.TASA}::numeric,
          ${data.IVA}::numeric,
          ${data.IMP_INT}::numeric,
          ${data.PERCEP}::numeric,
          ${data.OBSERVAC},
          ${articuloCodigo},
          ${proveedorId}::integer,
          ${localId}::integer
        )`;
      });

      await prisma.$executeRaw(Prisma.sql`
        INSERT INTO detalle_compras (
          "rowId", "codPro", "codCpb", numero1, numero2, comprobante, fecha, codigo,
          nombre, medida, cantidad, neto, "totalIns", "ivaTot", "impNtTot", tasa, iva,
          "impInt", percep, observac, "articuloCodigo", "proveedorId", "localId"
        )
        VALUES ${Prisma.join(rowValues)}
        ON CONFLICT ("rowId") DO UPDATE SET
          "codPro"        = EXCLUDED."codPro",
          "codCpb"        = EXCLUDED."codCpb",
          numero1         = EXCLUDED.numero1,
          numero2         = EXCLUDED.numero2,
          comprobante     = EXCLUDED.comprobante,
          fecha           = EXCLUDED.fecha,
          codigo          = EXCLUDED.codigo,
          nombre          = EXCLUDED.nombre,
          medida          = EXCLUDED.medida,
          cantidad        = EXCLUDED.cantidad,
          neto            = EXCLUDED.neto,
          "totalIns"      = EXCLUDED."totalIns",
          "ivaTot"        = EXCLUDED."ivaTot",
          "impNtTot"      = EXCLUDED."impNtTot",
          tasa            = EXCLUDED.tasa,
          iva             = EXCLUDED.iva,
          "impInt"        = EXCLUDED."impInt",
          percep          = EXCLUDED.percep,
          observac        = EXCLUDED.observac,
          "articuloCodigo"= EXCLUDED."articuloCodigo",
          "proveedorId"   = EXCLUDED."proveedorId",
          -- COALESCE: reclama filas huérfanas (localId=null) sin sobreescribir local ya asignado.
          "localId"       = COALESCE(detalle_compras."localId", EXCLUDED."localId")
      `);

      for (const rowId of chunkRowIds) {
        if (existingSet.has(rowId)) updated++; else created++;
      }
    } catch (err) {
      errors.push({
        rowIndex: i,
        rawCodigo: chunk[0]?.data.CODIGO,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (ctx?.localId != null && (created > 0 || updated > 0)) {
    await linkDetalleComprasByComprobante(prisma, ctx.localId);
  }

  return { created, updated, skipped, skippedRows, errors };
}
