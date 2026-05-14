import { createHash } from "crypto";
import type { PrismaClient } from "@prisma/client";
import { normalizeText, trim, toDecimal, excelDateToISO } from "../helpers";
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
  prisma: PrismaClient
): Promise<{ created: number; updated: number; skipped: number; errors: ETLRowError[] }> {
  let created = 0, updated = 0;
  const errors: ETLRowError[] = [];

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

  for (let i = 0; i < filtered.length; i++) {
    const r = filtered[i];
    const rawCodigo = r["CODIGO"];
    try {
      const rowId = makeRowId(r);
      const data = {
        codPro:      trim(r["COD_PRO"]),
        codCpb:      trim(r["COD_CPB"]),
        numero1:     trim(r["NUMERO1"]),
        numero2:     trim(r["NUMERO2"]),
        comprobante: makeComprobante(r),
        fecha:       excelDateToISO(r["FECHA"]) ? new Date(excelDateToISO(r["FECHA"])!) : null,
        codigo:      trim(r["CODIGO"]),
        nombre:      normalizeText(r["NOMBRE"]),
        medida:      trim(r["MEDIDA"]),
        cantidad:    toDecimal(r["CANTIDAD"]),
        neto:        toDecimal(r["NETO"]),
        totalIns:    toDecimal(r["TOTALINS"]),
        naTot:       toDecimal(r["IVATOT"]),
        impNtTot:    toDecimal(r["IMPINTTOT"]),
        tasa:        toDecimal(r["TASA"]),
        iva:         toDecimal(r["IVA"]),
        impInt:      toDecimal(r["IMP_INT"]),
        percep:      toDecimal(r["PERCEP"]),
        observac:      normalizeText(r["OBSERVAC"]),
        articuloCodigo: artSet.has(trim(r["CODIGO"]) ?? "") ? trim(r["CODIGO"]) : null,
        proveedorId:    provMapDet.get(trim(r["COD_PRO"]) ?? "") ?? null,
      };
      const existing = await prisma.detalleCompra.findUnique({ where: { rowId }, select: { rowId: true } });
      await prisma.detalleCompra.upsert({
        where:  { rowId },
        update: data,
        create: { rowId, ...data },
      });
      if (existing) updated++; else created++;
    } catch (err) {
      errors.push({
        rowIndex: i,
        rawCodigo,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Vincular compraId: hacer match por comprobante entre ambas tablas
  await prisma.$executeRaw`
    UPDATE detalle_compras dc
    SET "compraId" = c."rowId"
    FROM compras c
    WHERE dc.comprobante = c.comprobante
      AND dc."compraId" IS NULL
  `;

  return { created, updated, skipped, errors };
}
