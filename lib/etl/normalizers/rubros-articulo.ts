import type { PrismaClient } from "@prisma/client";
import { normalizeText, trim, toBool, toDecimal, excelDateToISO } from "../helpers";
import type { ETLRow, ETLRowError } from "../types";

export async function normalizeRubrosArticulo(
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
      const existing = await prisma.rubroArticulo.findUnique({
        where: { codigo },
        select: { codigo: true },
      });
      await prisma.rubroArticulo.upsert({
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
