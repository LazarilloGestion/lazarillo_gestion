import type { PrismaClient } from "@prisma/client";
import { normalizeText, trim, toBool, excelDateToISO } from "../helpers";
import { processBatch } from "../normalizer-utils";
import type { ETLRow, ETLRowError } from "../types";

export async function normalizeSubrubrosArticulo(
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
    (await prisma.subrubroArticulo.findMany({
      where: { codigo: { in: allCodigos } },
      select: { codigo: true },
    })).map((x) => x.codigo)
  );

  const errors = await processBatch(
    filtered,
    async (r) => {
      const codigo = String(r["CODIGO"]).trim();
      const fechaRaw = excelDateToISO(r["FECHA_UPDA"]);
      const data = {
        nombre: normalizeText(r["NOMBRE"]) ?? "(sin nombre)",
        deliAct: toBool(r["DELIACT"]),
        eveFor: trim(r["EVE_FOR"]),
        eveForm: trim(r["EVE_FORM"]),
        eveFormH: trim(r["EVE_FORMH"]),
        fechaUpda: fechaRaw ? new Date(fechaRaw) : null,
      };
      await prisma.subrubroArticulo.upsert({
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
