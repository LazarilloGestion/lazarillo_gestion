import type { PrismaClient } from "@prisma/client";
import { normalizeText, trim } from "../helpers";
import type { ETLRow, ETLRowError } from "../types";

export async function normalizeConceptosCaja(
  rows: ETLRow[],
  prisma: PrismaClient
): Promise<{ created: number; updated: number; skipped: number; errors: ETLRowError[] }> {
  let created = 0, updated = 0;
  const errors: ETLRowError[] = [];

  const filtered = rows.filter((r) => r["ID"] != null);
  const skipped = rows.length - filtered.length;

  for (let i = 0; i < filtered.length; i++) {
    const r = filtered[i];
    const rawCodigo = r["CODIGO"];
    try {
      const codigo = String(rawCodigo);
      const data = {
        nombre: normalizeText(r["NOMBRE"]) ?? "(sin nombre)",
        tipo: trim(r["TIPO"]),
        codImp: trim(r["COD_IMP"]),
        codRga:
          r["COD_RGA"] != null && Number(r["COD_RGA"]) > 0
            ? String(r["COD_RGA"])
            : null,
      };
      const existing = await prisma.conceptoCaja.findUnique({
        where: { codigo },
        select: { codigo: true },
      });
      await prisma.conceptoCaja.upsert({
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
