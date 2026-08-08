import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import type { DbClient } from "../types";
import { trim, toDecimalStr, normalizeText, excelDateToISO } from "../helpers";
import { linkDetalleComprasByComprobante } from "../normalizer-utils";
import { compraRowSchema, type CompraRow } from "../schemas/compras";
import { formatZodError } from "../schemas/common";

import type { ETLRow, ETLRowError, ETLContext, ETLSkippedRow } from "../types";

// Filas por chunk de INSERT ... ON CONFLICT. Con ~18 columnas: ~9k params/chunk < 65535.
const CHUNK_SIZE = 500;

// Códigos del ERP en compras que difieren del COD_CPB en detalle_compras
const CODE_ALIASES: Record<string, string> = {
  TIC: "Z",
};

// Convierte "A 0606-00761530" → "A060600761530" (mismo formato que detalle_compras.comprobante)
function parseComprobanteFromDetalle(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const match = s.match(/^(\S+)\s+(\d+)-(\d+)$/);
  if (!match) return null;
  const [, cod, num1, num2] = match;
  const normalizedCod = CODE_ALIASES[cod.toUpperCase()] ?? cod.toUpperCase();
  return normalizedCod + num1.padStart(4, "0") + num2.padStart(8, "0");
}

// makeRowId opera SIEMPRE sobre la fila cruda (ETLRow), nunca sobre datos ya
// coercionados por Zod — el hash tiene que ser estable entre reimports del mismo
// archivo, y cambiar la representación de entrada cambiaría el hash de filas ya
// existentes en la base (se perderían como "nuevas" en vez de actualizarse).
function makeRowId(r: ETLRow): string {
  // DETALLE (nro. comprobante) está vacío en ~40% de filas (sueldos, publicidad, alquiler).
  // OBSERVAC diferencia esos casos (ej: "gonza cumple" vs "luna cumple" el mismo día).
  // IMPORTE incluido para distinguir dos transacciones genuinamente distintas con mismos campos
  // descriptivos (ej: dos retiros el mismo día con diferente monto). Las correcciones del ERP
  // generarán una fila nueva en vez de upsert — perder transacciones reales es peor que eso.
  // Usar normalizeText en OBSERVAC para que variaciones de casing/espacios no generen rowIds distintos.
  const key = [r["COD_CGA"], r["FECHA"], r["CODIGO"], r["CONCEPTO"], r["DETALLE"], normalizeText(r["OBSERVAC"]), r["IMPORTE"]]
    .map((v) => String(v ?? ""))
    .join("|");
  return createHash("sha256").update(key).digest("hex").substring(0, 24);
}

function formatFechaDisplay(val: unknown): string | undefined {
  const iso = excelDateToISO(val);
  if (!iso) return undefined;
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export async function normalizeCompras(
  rows: ETLRow[],
  prisma: DbClient,
  ctx?: ETLContext
): Promise<{ created: number; updated: number; skipped: number; skippedRows: ETLSkippedRow[]; errors: ETLRowError[] }> {
  const skippedRows: ETLSkippedRow[] = [];
  const errors: ETLRowError[] = [];

  // 1) Filtro de presencia: identificadores realmente ausentes → sin_datos.
  //    Endurecido con trim() en COD_CGA para capturar strings vacíos/whitespace,
  //    no sólo null (gap que existía en el chequeo anterior).
  // 2) Zod: fila con identificadores presentes pero algún campo (incluida FECHA
  //    corrupta, no sólo ausente) que no parsea → errors, no null en silencio.
  type ParsedRow = { rowId: string; row: ETLRow; data: CompraRow };
  const parsedRows: ParsedRow[] = [];

  rows.forEach((r, idx) => {
    if (trim(r["COD_CGA"]) == null || r["FECHA"] == null) {
      skippedRows.push({
        fecha: formatFechaDisplay(r["FECHA"]),
        concepto: trim(r["CONCEPTO"]) ?? undefined,
        importe: toDecimalStr(r["IMPORTE"]) ?? undefined,
        proveedor: trim(r["PROVEEDOR"]) ?? undefined,
        motivo: "sin_datos",
      });
      return;
    }
    const parsed = compraRowSchema.safeParse(r);
    if (!parsed.success) {
      errors.push({ rowIndex: idx, rawCodigo: r["CODIGO"], message: formatZodError(parsed.error) });
      return;
    }
    parsedRows.push({ rowId: makeRowId(r), row: r, data: parsed.data });
  });

  // Dedup por rowId — last-wins, pero ahora la fila que se pisa se reporta en
  // skippedRows con motivo "duplicado" en vez de perderse en silencio (antes
  // era exactamente el patrón que causó la pérdida del registro de $2.6M).
  const rowIdMap = new Map<string, ParsedRow>();
  for (const pr of parsedRows) {
    const prev = rowIdMap.get(pr.rowId);
    if (prev) {
      skippedRows.push({
        fecha: formatFechaDisplay(prev.row["FECHA"]),
        concepto: trim(prev.row["CONCEPTO"]) ?? undefined,
        importe: toDecimalStr(prev.row["IMPORTE"]) ?? undefined,
        proveedor: trim(prev.row["PROVEEDOR"]) ?? undefined,
        motivo: "duplicado",
      });
    }
    rowIdMap.set(pr.rowId, pr);
  }
  const filtered = Array.from(rowIdMap.values());
  const skipped = skippedRows.length;

  // Lookup tables — una sola query cada una para todo el archivo
  const codigosProv = [...new Set(filtered.map((pr) => pr.data.CODIGO).filter((v): v is string => v != null))];
  const provMap = new Map(
    (await prisma.proveedor.findMany({
      where: { codigo: { in: codigosProv } },
      select: { id: true, codigo: true },
    })).map((p) => [p.codigo, p.id])
  );

  const codigosConcepto = [...new Set(filtered.map((pr) => pr.data.COD_CGA).filter((v): v is string => v != null))];
  const conceptosInfo = await prisma.conceptoCaja.findMany({
    where: { codigo: { in: codigosConcepto } },
    select: { codigo: true, nombre: true, rubro: { select: { nombre: true } } },
  });
  const conceptoSet = new Set(conceptosInfo.map((c) => c.codigo));

  // Gastos de personal (rubro "Gastos En Personal" / concepto "Liquidacion Sueldo"):
  // el CODIGO de la fila es un identificador de empleado de la planilla de origen,
  // no un código de proveedor — puede colisionar por casualidad con un Proveedor real
  // del maestro. Para estas filas nunca resolvemos proveedorId contra el maestro; el
  // nombre correcto ya viene en el texto propio de la fila (columna proveedor).
  const codigosGastoPersonal = new Set(
    conceptosInfo
      .filter((c) => c.rubro?.nombre === "Gastos En Personal" && c.nombre === "Liquidacion Sueldo")
      .map((c) => c.codigo)
  );

  const localId = ctx?.localId ?? null;
  const puntoDeVentaId = ctx?.puntoDeVentaId ?? null;

  let created = 0;
  let updated = 0;

  for (let i = 0; i < filtered.length; i += CHUNK_SIZE) {
    const chunk = filtered.slice(i, i + CHUNK_SIZE);
    const chunkRowIds = chunk.map((pr) => pr.rowId);

    const existingSet = new Set(
      (await prisma.compra.findMany({
        where: { rowId: { in: chunkRowIds } },
        select: { rowId: true },
      })).map((c) => c.rowId)
    );

    try {
      const rowValues = chunk.map(({ rowId, row, data }) => {
        const proveedorId =
          data.CODIGO != null && !codigosGastoPersonal.has(data.COD_CGA) ? provMap.get(data.CODIGO) ?? null : null;
        const conceptoCodigo = conceptoSet.has(data.COD_CGA) ? data.COD_CGA : null;

        return Prisma.sql`(
          ${rowId},
          ${data.COD_CGA},
          ${data.CONCEPTO},
          ${parseComprobanteFromDetalle(row["DETALLE"])},
          ${data.FECHA},
          ${data.CODIGO},
          ${data.PROVEEDOR},
          ${data.DETALLE},
          ${data.OBSERVAC},
          ${data.IMPORTE}::numeric,
          ${data.IMPORTE}::numeric,
          ${data.IMP_INT}::numeric,
          ${data.IMPUTAC},
          ${data.PER1}::numeric,
          ${data.PER2}::numeric,
          ${data.PER3}::numeric,
          ${proveedorId}::integer,
          ${conceptoCodigo},
          ${localId}::integer,
          ${puntoDeVentaId}::integer
        )`;
      });

      await prisma.$executeRaw(Prisma.sql`
        INSERT INTO compras (
          "rowId", "codCga", concepto, comprobante, fecha, codigo, proveedor, detalle, observac,
          importe, "importeTrabajado", "impInt", imputac, per1, per2, per3,
          "proveedorId", "conceptoCodigo", "localId", "puntoDeVentaId"
        )
        VALUES ${Prisma.join(rowValues)}
        ON CONFLICT ("rowId") DO UPDATE SET
          "codCga"           = EXCLUDED."codCga",
          concepto           = EXCLUDED.concepto,
          comprobante        = EXCLUDED.comprobante,
          fecha              = EXCLUDED.fecha,
          codigo             = EXCLUDED.codigo,
          proveedor          = EXCLUDED.proveedor,
          detalle            = EXCLUDED.detalle,
          observac           = EXCLUDED.observac,
          importe            = EXCLUDED.importe,
          "importeTrabajado" = EXCLUDED."importeTrabajado",
          "impInt"           = EXCLUDED."impInt",
          imputac            = EXCLUDED.imputac,
          per1               = EXCLUDED.per1,
          per2               = EXCLUDED.per2,
          per3               = EXCLUDED.per3,
          "proveedorId"      = EXCLUDED."proveedorId",
          "conceptoCodigo"   = EXCLUDED."conceptoCodigo",
          -- COALESCE: reclama filas huérfanas (localId=null) sin sobreescribir local ya asignado.
          "localId"          = COALESCE(compras."localId", EXCLUDED."localId"),
          "puntoDeVentaId"   = COALESCE(compras."puntoDeVentaId", EXCLUDED."puntoDeVentaId")
          -- importeManual, fechaManual, conceptoCodigoManual: NO se sobreescriben (overrides manuales)
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
