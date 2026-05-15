import { createHash } from "crypto";
import type { DbClient } from "../types";
import { normalizeText, trim, toDecimal, toDecimalStr, safeDate } from "../helpers";
import { processBatch, linkDetalleComprasByComprobante } from "../normalizer-utils";
import type { ETLRow, ETLRowError } from "../types";

function makeComprobante(r: ETLRow): string | null {
  const cpb  = String(r["COD_CPB"] ?? "").trim();
  const num1 = String(r["NUMERO1"] ?? "").trim().padStart(4, "0");
  const num2 = String(r["NUMERO2"] ?? "").trim().padStart(8, "0");
  if (!cpb) return null;
  return `${cpb}${num1}${num2}`;
}

function makeRowId(r: ETLRow): string {
  const key = [r["COD_CPB"], r["NUMERO1"], r["NUMERO2"], r["CODIGO"]]
    .map((v) => String(v ?? ""))
    .join("|");
  return createHash("sha256").update(key).digest("hex").substring(0, 24);
}

export async function normalizeDetalleCompras(
  rows: ETLRow[],
  prisma: DbClient
): Promise<{ created: number; updated: number; skipped: number; errors: ETLRowError[] }> {
  let created = 0, updated = 0;

  const filtered = rows.filter((r) => r["COD_CPB"] != null && r["CODIGO"] != null);
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

  const allRowIds = filtered.map((r) => makeRowId(r));
  const existingRowIds = new Set(
    (await prisma.detalleCompra.findMany({
      where: { rowId: { in: allRowIds } },
      select: { rowId: true },
    })).map((d) => d.rowId)
  );

  const errors = await processBatch(
    filtered,
    async (r) => {
      const rowId = makeRowId(r);
      const data = {
        codPro:      trim(r["COD_PRO"]),
        codCpb:      trim(r["COD_CPB"]),
        numero1:     trim(r["NUMERO1"]),
        numero2:     trim(r["NUMERO2"]),
        comprobante: makeComprobante(r),
        fecha:       safeDate(r["FECHA"]),
        codigo:      trim(r["CODIGO"]),
        nombre:      normalizeText(r["NOMBRE"]),
        medida:      trim(r["MEDIDA"]),
        cantidad:    toDecimal(r["CANTIDAD"]),   // cantidad de unidades, no monetario
        neto:        toDecimalStr(r["NETO"]),
        totalIns:    toDecimalStr(r["TOTALINS"]),
        ivaTot:      toDecimalStr(r["IVATOT"]),
        impNtTot:    toDecimalStr(r["IMPINTTOT"]),
        tasa:        toDecimal(r["TASA"]),        // porcentaje, no monetario
        iva:         toDecimalStr(r["IVA"]),
        impInt:      toDecimalStr(r["IMP_INT"]),
        percep:      toDecimalStr(r["PERCEP"]),
        observac:    normalizeText(r["OBSERVAC"]),
        articuloCodigo: artSet.has(trim(r["CODIGO"]) ?? "") ? trim(r["CODIGO"]) : null,
        proveedorId:    provMapDet.get(trim(r["COD_PRO"]) ?? "") ?? null,
      };
      await prisma.detalleCompra.upsert({
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
