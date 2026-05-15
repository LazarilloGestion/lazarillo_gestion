import { createHash } from "crypto";
import type { DbClient } from "../types";
import { trim, toDecimal, toDecimalStr, safeDate } from "../helpers";
import { processBatch, linkDetalleComprasByComprobante } from "../normalizer-utils";
import type { ETLRow, ETLRowError, ETLContext } from "../types";

// Convierte "A 0606-00761530" → "A060600761530" (mismo formato que detalle_compras.comprobante)
function parseComprobanteFromDetalle(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const match = s.match(/^(\S+)\s+(\d+)-(\d+)$/);
  if (!match) return null;
  const [, cod, num1, num2] = match;
  return cod + num1.padStart(4, "0") + num2.padStart(8, "0");
}

function makeRowId(r: ETLRow): string {
  const key = [r["COD_CGA"], r["FECHA"], r["CODIGO"], r["CONCEPTO"], r["IMPORTE"]]
    .map((v) => String(v ?? ""))
    .join("|");
  return createHash("sha256").update(key).digest("hex").substring(0, 24);
}

export async function normalizeCompras(
  rows: ETLRow[],
  prisma: DbClient,
  ctx?: ETLContext
): Promise<{ created: number; updated: number; skipped: number; errors: ETLRowError[] }> {
  let created = 0, updated = 0;

  const filtered = rows.filter((r) => r["COD_CGA"] != null || r["FECHA"] != null);
  const skipped = rows.length - filtered.length;

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

  const allRowIds = filtered.map((r) => makeRowId(r));
  const existingRowIds = new Set(
    (await prisma.compra.findMany({
      where: { rowId: { in: allRowIds } },
      select: { rowId: true },
    })).map((c) => c.rowId)
  );

  const errors = await processBatch(
    filtered,
    async (r) => {
      const rowId = makeRowId(r);
      const importe = toDecimalStr(r["IMPORTE"]);
      const data = {
        codCga:      trim(r["COD_CGA"]),
        concepto:    trim(r["CONCEPTO"]),
        comprobante: parseComprobanteFromDetalle(r["DETALLE"]),
        fecha:       safeDate(r["FECHA"]),
        codigo:      trim(r["CODIGO"]),
        proveedor:   trim(r["PROVEEDOR"]),
        detalle:     trim(r["DETALLE"]),
        observac:    trim(r["OBSERVAC"]),
        importe:          importe,
        importeTrabajado: importe,
        impInt:    toDecimalStr(r["IMP_INT"]),
        imputac:   trim(r["IMPUTAC"]),
        per1:      toDecimalStr(r["PER1"]),
        per2:      toDecimalStr(r["PER2"]),
        per3:      toDecimalStr(r["PER3"]),
        proveedorId:    provMap.get(trim(r["CODIGO"]) ?? "") ?? null,
        conceptoCodigo: conceptoSet.has(trim(r["COD_CGA"]) ?? "") ? trim(r["COD_CGA"]) : null,
        localId:        ctx?.localId ?? null,
        puntoDeVentaId: ctx?.puntoDeVentaId ?? null,
      };
      await prisma.compra.upsert({
        where:  { rowId },
        update: data,
        create: { rowId, ...data },
      });
      if (existingRowIds.has(rowId)) updated++; else created++;
    },
    (r) => r["CODIGO"]
  );

  await linkDetalleComprasByComprobante(prisma);

  return { created, updated, skipped, errors };
}
