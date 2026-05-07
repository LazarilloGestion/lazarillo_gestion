import type { PrismaClient } from "@prisma/client";
import { normalizeText, toDecimal } from "../helpers";
import type { ETLRow, ETLRowError } from "../types";

export async function normalizeArticulos(
  rows: ETLRow[],
  prisma: PrismaClient
): Promise<{ created: number; updated: number; skipped: number; errors: ETLRowError[] }> {
  let created = 0, updated = 0;
  const errors: ETLRowError[] = [];

  const filtered = rows.filter((r) => r["CODIGO"] != null);
  const skipped = rows.length - filtered.length;

  for (let i = 0; i < filtered.length; i++) {
    const r = filtered[i];
    const rawCodigo = r["CODIGO"];
    try {
      const codigo = String(rawCodigo);
      const data = {
        nombre: normalizeText(r["NOMBRE"]) ?? "(sin nombre)",
        precio1: toDecimal(r["PRECIO1"]),
        precio2: toDecimal(r["PRECIO2"]),
        precio3: toDecimal(r["PRECIO3"]),
        precio4: toDecimal(r["PRECIO4"]),
        codRua:
          r["COD_RUA"] != null && Number(r["COD_RUA"]) > 0
            ? String(r["COD_RUA"])
            : null,
        codSua:
          r["COD_SUA"] != null && Number(r["COD_SUA"]) > 0
            ? String(r["COD_SUA"])
            : null,
      };
      const existing = await prisma.articulo.findUnique({
        where: { codigo },
        select: { codigo: true },
      });
      await prisma.articulo.upsert({
        where: { codigo },
        update: data,
        create: { codigo, ...data },
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
