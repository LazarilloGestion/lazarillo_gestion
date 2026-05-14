import type { PrismaClient } from "@prisma/client";
import { normalizeText, trim } from "../helpers";
import { processBatch } from "../normalizer-utils";
import type { ETLRow, ETLRowError } from "../types";

export async function normalizeRubrosConceptoCaja(
  rows: ETLRow[],
  prisma: PrismaClient
): Promise<{ created: number; updated: number; skipped: number; errors: ETLRowError[] }> {
  let created = 0, updated = 0;

  const filtered = rows.filter((r) => {
    const c = trim(r["CODIGO"]);
    return c != null && c !== "";
  });
  const skipped = rows.length - filtered.length;

  const allCodigos = filtered.map((r) => String(r["CODIGO"]).trim());
  const existingCodigos = new Set(
    (await prisma.rubroConceptoCaja.findMany({
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
        calcRent: trim(r["CALC_RENT"]),
      };
      await prisma.rubroConceptoCaja.upsert({
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
