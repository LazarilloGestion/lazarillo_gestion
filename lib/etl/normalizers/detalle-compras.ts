import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import type { DbClient } from "../types";
import { normalizeText, trim, toDecimalStr, safeDate } from "../helpers";
import { linkDetalleComprasByComprobante } from "../normalizer-utils";
import type { ETLRow, ETLRowError } from "../types";

const CHUNK_SIZE = 500;

function makeComprobante(r: ETLRow): string | null {
  const cpb  = String(r["COD_CPB"] ?? "").trim();
  const num1 = String(r["NUMERO1"] ?? "").trim().padStart(4, "0");
  const num2 = String(r["NUMERO2"] ?? "").trim().padStart(8, "0");
  if (!cpb) return null;
  return `${cpb}${num1.padStart(4, "0")}${num2.padStart(8, "0")}`;
}

function makeRowId(r: ETLRow): string {
  // El ERP no exporta número de línea — CANTIDAD+NETO son los únicos
  // diferenciadores cuando el mismo artículo aparece dos veces en la misma factura.
  const key = [r["COD_CPB"], r["NUMERO1"], r["NUMERO2"], r["CODIGO"], r["CANTIDAD"], r["NETO"]]
    .map((v) => String(v ?? ""))
    .join("|");
  return createHash("sha256").update(key).digest("hex").substring(0, 24);
}

export async function normalizeDetalleCompras(
  rows: ETLRow[],
  prisma: DbClient
): Promise<{ created: number; updated: number; skipped: number; errors: ETLRowError[] }> {
  const valid = rows.filter((r) => r["COD_CPB"] != null && r["CODIGO"] != null);
  const filtered = Array.from(
    valid.reduce((m, r) => m.set(makeRowId(r), r), new Map<string, ETLRow>()).values()
  );
  const skipped = rows.length - filtered.length;

  const codigosArt = [...new Set(filtered.map((r) => trim(r["CODIGO"])).filter(Boolean))] as string[];
  const artSet = new Set(
    (await prisma.articulo.findMany({
      where: { codigo: { in: codigosArt } },
      select: { codigo: true },
    })).map((a) => a.codigo)
  );

  const codigosProvDet = [...new Set(filtered.map((r) => trim(r["COD_PRO"])).filter(Boolean))] as string[];
  const provMapDet = new Map(
    (await prisma.proveedor.findMany({
      where: { codigo: { in: codigosProvDet } },
      select: { id: true, codigo: true },
    })).map((p) => [p.codigo, p.id])
  );

  let created = 0;
  let updated = 0;
  const errors: ETLRowError[] = [];

  for (let i = 0; i < filtered.length; i += CHUNK_SIZE) {
    const chunk = filtered.slice(i, i + CHUNK_SIZE);
    const chunkRowIds = chunk.map(makeRowId);

    const existingSet = new Set(
      (await prisma.detalleCompra.findMany({
        where: { rowId: { in: chunkRowIds } },
        select: { rowId: true },
      })).map((d) => d.rowId)
    );

    try {
      const rowValues = chunk.map((r) => {
        const rowId = makeRowId(r);
        const articuloCodigo = artSet.has(trim(r["CODIGO"]) ?? "") ? trim(r["CODIGO"]) : null;
        const proveedorId = provMapDet.get(trim(r["COD_PRO"]) ?? "") ?? null;
        return Prisma.sql`(
          ${rowId},
          ${trim(r["COD_PRO"])},
          ${trim(r["COD_CPB"])},
          ${trim(r["NUMERO1"])},
          ${trim(r["NUMERO2"])},
          ${makeComprobante(r)},
          ${safeDate(r["FECHA"])},
          ${trim(r["CODIGO"])},
          ${normalizeText(r["NOMBRE"])},
          ${trim(r["MEDIDA"])},
          ${toDecimalStr(r["CANTIDAD"])}::numeric,
          ${toDecimalStr(r["NETO"])}::numeric,
          ${toDecimalStr(r["TOTALINS"])}::numeric,
          ${toDecimalStr(r["IVATOT"])}::numeric,
          ${toDecimalStr(r["IMPINTTOT"])}::numeric,
          ${toDecimalStr(r["TASA"])}::numeric,
          ${toDecimalStr(r["IVA"])}::numeric,
          ${toDecimalStr(r["IMP_INT"])}::numeric,
          ${toDecimalStr(r["PERCEP"])}::numeric,
          ${normalizeText(r["OBSERVAC"])},
          ${articuloCodigo},
          ${proveedorId}::integer
        )`;
      });

      await (prisma as unknown as { $executeRaw: (q: Prisma.Sql) => Promise<number> }).$executeRaw(Prisma.sql`
        INSERT INTO detalle_compras (
          "rowId", "codPro", "codCpb", numero1, numero2, comprobante, fecha, codigo,
          nombre, medida, cantidad, neto, "totalIns", "ivaTot", "impNtTot", tasa, iva,
          "impInt", percep, observac, "articuloCodigo", "proveedorId"
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
          "proveedorId"   = EXCLUDED."proveedorId"
      `);

      for (const rowId of chunkRowIds) {
        if (existingSet.has(rowId)) updated++; else created++;
      }
    } catch (err) {
      errors.push({
        rowIndex: i,
        rawCodigo: chunk[0]?.["CODIGO"],
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await linkDetalleComprasByComprobante(prisma);

  return { created, updated, skipped, errors };
}
