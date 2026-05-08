import { createHash } from "crypto";
import type { PrismaClient } from "@prisma/client";
import { normalizeText, trim, toDecimal, excelDateToISO } from "../helpers";
import type { ETLRow, ETLRowError, ETLContext } from "../types";

function makeRowId(r: ETLRow): string {
  const key = [r["COD_CGA"], r["FECHA"], r["CODIGO"], r["CONCEPTO"], r["IMPORTE"]]
    .map((v) => String(v ?? ""))
    .join("|");
  return createHash("sha256").update(key).digest("hex").substring(0, 24);
}

export async function normalizeCompras(
  rows: ETLRow[],
  prisma: PrismaClient,
  ctx?: ETLContext
): Promise<{ created: number; updated: number; skipped: number; errors: ETLRowError[] }> {
  let created = 0, updated = 0;
  const errors: ETLRowError[] = [];

  const filtered = rows.filter((r) => r["COD_CGA"] != null || r["FECHA"] != null);
  const skipped = rows.length - filtered.length;

  for (let i = 0; i < filtered.length; i++) {
    const r = filtered[i];
    const rawCodigo = r["CODIGO"];
    try {
      const rowId = makeRowId(r);
      const importe = toDecimal(r["IMPORTE"]);
      const data = {
        codCga:    trim(r["COD_CGA"]),
        concepto:  normalizeText(r["CONCEPTO"]),
        fecha:     excelDateToISO(r["FECHA"]) ? new Date(excelDateToISO(r["FECHA"])!) : null,
        codigo:    trim(r["CODIGO"]),
        proveedor: normalizeText(r["PROVEEDOR"]),
        detalle:   normalizeText(r["DETALLE"]),
        observac:  normalizeText(r["OBSERVAC"]),
        importe:   importe != null ? importe : null,
        importeTrabajado: importe != null ? importe : null,
        impInt:    toDecimal(r["IMP_INT"]),
        imputac:   trim(r["IMPUTAC"]),
        per1:      toDecimal(r["PER1"]),
        per2:      toDecimal(r["PER2"]),
        per3:      toDecimal(r["PER3"]),
        localId:        ctx?.localId ?? null,
        puntoDeVentaId: ctx?.puntoDeVentaId ?? null,
      };
      const existing = await prisma.compra.findUnique({ where: { rowId }, select: { rowId: true } });
      await prisma.compra.upsert({
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

  return { created, updated, skipped, errors };
}
