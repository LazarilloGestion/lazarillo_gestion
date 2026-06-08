import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import type { DbClient } from "../types";
import { trim, toDecimalStr, safeDate, normalizeText } from "../helpers";
import { linkDetalleComprasByComprobante } from "../normalizer-utils";

import type { ETLRow, ETLRowError, ETLContext } from "../types";

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

function makeRowId(r: ETLRow): string {
  // DETALLE (nro. comprobante) está vacío en ~40% de filas (sueldos, publicidad, alquiler).
  // OBSERVAC diferencia esos casos (ej: "gonza cumple" vs "luna cumple" el mismo día).
  // No incluir IMPORTE: correcciones del ERP en filas con igual OBSERVAC deben hacer upsert.
  const key = [r["COD_CGA"], r["FECHA"], r["CODIGO"], r["CONCEPTO"], r["DETALLE"], r["OBSERVAC"]]
    .map((v) => String(v ?? ""))
    .join("|");
  return createHash("sha256").update(key).digest("hex").substring(0, 24);
}

export async function normalizeCompras(
  rows: ETLRow[],
  prisma: DbClient,
  ctx?: ETLContext
): Promise<{ created: number; updated: number; skipped: number; errors: ETLRowError[] }> {
  const valid = rows.filter((r) => r["COD_CGA"] != null && r["FECHA"] != null);
  // Deduplicar por rowId — last wins (el ERP puede repetir filas; el upsert anterior también lo resolvía así)
  const filtered = Array.from(
    valid.reduce((m, r) => m.set(makeRowId(r), r), new Map<string, ETLRow>()).values()
  );
  // skipped = filas inválidas + duplicados dentro del archivo
  const skipped = rows.length - filtered.length;

  // Lookup tables — una sola query cada una para todo el archivo
  const codigosProv = [...new Set(filtered.map((r) => trim(r["CODIGO"])).filter(Boolean))] as string[];
  const provMap = new Map(
    (await prisma.proveedor.findMany({
      where: { codigo: { in: codigosProv } },
      select: { id: true, codigo: true },
    })).map((p) => [p.codigo, p.id])
  );

  const codigosConcepto = [...new Set(filtered.map((r) => trim(r["COD_CGA"])).filter(Boolean))] as string[];
  const conceptoSet = new Set(
    (await prisma.conceptoCaja.findMany({
      where: { codigo: { in: codigosConcepto } },
      select: { codigo: true },
    })).map((c) => c.codigo)
  );

  const localId = ctx?.localId ?? null;
  const puntoDeVentaId = ctx?.puntoDeVentaId ?? null;

  let created = 0;
  let updated = 0;
  const errors: ETLRowError[] = [];

  for (let i = 0; i < filtered.length; i += CHUNK_SIZE) {
    const chunk = filtered.slice(i, i + CHUNK_SIZE);
    const chunkRowIds = chunk.map(makeRowId);

    const existingSet = new Set(
      (await prisma.compra.findMany({
        where: { rowId: { in: chunkRowIds } },
        select: { rowId: true },
      })).map((c) => c.rowId)
    );

    try {
      const rowValues = chunk.map((r) => {
        const rowId = makeRowId(r);
        const importe = toDecimalStr(r["IMPORTE"]);
        const proveedorId = provMap.get(trim(r["CODIGO"]) ?? "") ?? null;
        const conceptoCodigo = conceptoSet.has(trim(r["COD_CGA"]) ?? "") ? trim(r["COD_CGA"]) : null;

        return Prisma.sql`(
          ${rowId},
          ${trim(r["COD_CGA"])},
          ${trim(r["CONCEPTO"])},
          ${parseComprobanteFromDetalle(r["DETALLE"])},
          ${safeDate(r["FECHA"])},
          ${trim(r["CODIGO"])},
          ${trim(r["PROVEEDOR"])},
          ${trim(r["DETALLE"])},
          ${normalizeText(r["OBSERVAC"])},
          ${importe}::numeric,
          ${importe}::numeric,
          ${toDecimalStr(r["IMP_INT"])}::numeric,
          ${trim(r["IMPUTAC"])},
          ${toDecimalStr(r["PER1"])}::numeric,
          ${toDecimalStr(r["PER2"])}::numeric,
          ${toDecimalStr(r["PER3"])}::numeric,
          ${proveedorId}::integer,
          ${conceptoCodigo},
          ${localId}::integer,
          ${puntoDeVentaId}::integer
        )`;
      });

      await (prisma as unknown as { $executeRaw: (q: Prisma.Sql) => Promise<number> }).$executeRaw(Prisma.sql`
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
          "localId"          = EXCLUDED."localId",
          "puntoDeVentaId"   = EXCLUDED."puntoDeVentaId"
          -- importeManual, fechaManual, conceptoCodigoManual: NO se sobreescriben (overrides manuales)
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

  if (ctx?.localId != null) {
    await linkDetalleComprasByComprobante(prisma, ctx.localId);
  }

  return { created, updated, skipped, errors };
}
