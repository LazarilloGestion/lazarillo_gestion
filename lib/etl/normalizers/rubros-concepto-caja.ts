import { Prisma } from "@prisma/client";
import type { DbClient } from "../types";
import { trim } from "../helpers";
import type { ETLRow, ETLRowError } from "../types";
import { rubroConceptoCajaRowSchema, type RubroConceptoCajaRow } from "../schemas/rubros-concepto-caja";
import { formatZodError } from "../schemas/common";

const CHUNK_SIZE = 500;

export async function normalizeRubrosConceptoCaja(
  rows: ETLRow[],
  prisma: DbClient
): Promise<{ created: number; updated: number; skipped: number; errors: ETLRowError[] }> {
  const errors: ETLRowError[] = [];
  let skipped = 0;

  // Deduplicar por codigo — last wins (intencional para maestros).
  const parsedByCodigo = new Map<string, RubroConceptoCajaRow>();

  rows.forEach((r, idx) => {
    if (trim(r["CODIGO"]) == null) {
      skipped++;
      return;
    }
    const parsed = rubroConceptoCajaRowSchema.safeParse(r);
    if (!parsed.success) {
      errors.push({ rowIndex: idx, rawCodigo: r["CODIGO"], message: formatZodError(parsed.error) });
      return;
    }
    parsedByCodigo.set(parsed.data.CODIGO, parsed.data);
  });

  const deduped = Array.from(parsedByCodigo.values());

  const allCodigos = deduped.map((d) => d.CODIGO);
  const existingSet = new Set(
    (await prisma.rubroConceptoCaja.findMany({ where: { codigo: { in: allCodigos } }, select: { codigo: true } }))
      .map((x) => x.codigo)
  );

  let created = 0, updated = 0;

  for (let i = 0; i < deduped.length; i += CHUNK_SIZE) {
    const chunk = deduped.slice(i, i + CHUNK_SIZE);
    try {
      const values = chunk.map((data) => {
        return Prisma.sql`(
          ${data.CODIGO},
          ${data.NOMBRE ?? "(sin nombre)"},
          ${data.CALC_RENT}
        )`;
      });

      await prisma.$executeRaw(Prisma.sql`
        INSERT INTO rubros_concepto_caja (codigo, nombre, "calcRent")
        VALUES ${Prisma.join(values)}
        ON CONFLICT (codigo) DO UPDATE SET
          nombre     = EXCLUDED.nombre,
          "calcRent" = EXCLUDED."calcRent"
          -- visibleEnDashboard: NO se sobreescribe (config manual del usuario)
      `);

      for (const data of chunk) {
        if (existingSet.has(data.CODIGO)) updated++; else created++;
      }
    } catch (err) {
      errors.push({ rowIndex: i, rawCodigo: chunk[0]?.CODIGO, message: err instanceof Error ? err.message : String(err) });
    }
  }

  return { created, updated, skipped, errors };
}
