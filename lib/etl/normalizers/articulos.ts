import type { PrismaClient } from "@prisma/client";
import { normalizeText, toDecimal } from "../helpers";
import { processBatch } from "../normalizer-utils";
import type { ETLRow, ETLRowError } from "../types";

export async function normalizeArticulos(
  rows: ETLRow[],
  prisma: PrismaClient
): Promise<{ created: number; updated: number; skipped: number; errors: ETLRowError[] }> {
  let created = 0, updated = 0;

  const filtered = rows.filter((r) => {
    const c = String(r["CODIGO"] ?? "").trim();
    return c !== "";
  });
  const skipped = rows.length - filtered.length;

  const allCodigos = filtered.map((r) => String(r["CODIGO"]).trim());
  const existingCodigos = new Set(
    (await prisma.articulo.findMany({
      where: { codigo: { in: allCodigos } },
      select: { codigo: true },
    })).map((x) => x.codigo)
  );

  const errors = await processBatch(
    filtered,
    async (r) => {
      const codigo = String(r["CODIGO"]).trim();
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
      await prisma.articulo.upsert({
        where: { codigo },
        update: data,
        create: { codigo, ...data },
      });
      if (existingCodigos.has(codigo)) updated++; else created++;
    },
    (r) => r["CODIGO"]
  );

  return { created, updated, skipped, errors };
}
