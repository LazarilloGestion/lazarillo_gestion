import type { PrismaClient } from "@prisma/client";
import { normalizeText, trim } from "../helpers";
import { processBatch } from "../normalizer-utils";
import type { ETLRow, ETLRowError } from "../types";

export async function normalizeConceptosCaja(
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
    (await prisma.conceptoCaja.findMany({
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
        tipo: trim(r["TIPO"]),
        codImp: trim(r["COD_IMP"]),
        codRga:
          r["COD_RGA"] != null && Number(r["COD_RGA"]) > 0
            ? String(r["COD_RGA"])
            : null,
      };
      await prisma.conceptoCaja.upsert({
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
