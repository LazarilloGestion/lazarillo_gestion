import type { DbClient } from "../types";
import { normalizeText, trim, toBool, toDecimal, excelDateToISO } from "../helpers";
import { processBatch } from "../normalizer-utils";
import type { ETLRow, ETLRowError } from "../types";

export async function normalizeRubrosArticulo(
  rows: ETLRow[],
  prisma: DbClient
): Promise<{ created: number; updated: number; skipped: number; errors: ETLRowError[] }> {
  let created = 0, updated = 0;

  const filtered = rows.filter((r) => {
    const c = trim(r["CODIGO"]);
    return c != null && c !== "";
  });
  const skipped = rows.length - filtered.length;

  const allCodigos = filtered.map((r) => String(r["CODIGO"]).trim());
  const existingCodigos = new Set(
    (await prisma.rubroArticulo.findMany({
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
        color: trim(r["COLOR"]),
        grupoNro: trim(r["GRUPO_NRO"]),
        grupoCol: trim(r["GRUPO_COL"]),
        grupoFot: trim(r["GRUPO_FOT"]),
        excluyeInf: toBool(r["EXCLUYEINF"]),
        evento: trim(r["EVENTO"]),
        deliAct: toBool(r["DELIACT"]),
        eveFor: trim(r["EVE_FOR"]),
        eveForm: trim(r["EVE_FORM"]),
        eveFormH: trim(r["EVE_FORMH"]),
        discont: toDecimal(r["DISCONT"]),
        fechaUpda: fechaRaw ? new Date(fechaRaw) : null,
        modoVista: trim(r["MODO_VISTA"]),
      };
      await prisma.rubroArticulo.upsert({
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
