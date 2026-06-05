import { Prisma } from "@prisma/client";
import type { DbClient } from "../types";
import { normalizeText, trim } from "../helpers";
import type { ETLRow, ETLRowError } from "../types";

const CHUNK_SIZE = 500;

export async function normalizeRubrosConceptoCaja(
  rows: ETLRow[],
  prisma: DbClient
): Promise<{ created: number; updated: number; skipped: number; errors: ETLRowError[] }> {
  const filtered = rows.filter((r) => trim(r["CODIGO"]) != null);
  const skipped = rows.length - filtered.length;

  // Deduplicar por codigo — last wins
  const deduped = Array.from(
    filtered.reduce((m, r) => m.set(String(r["CODIGO"]).trim(), r), new Map<string, ETLRow>()).values()
  );

  const allCodigos = deduped.map((r) => String(r["CODIGO"]).trim());
  const existingSet = new Set(
    (await prisma.rubroConceptoCaja.findMany({ where: { codigo: { in: allCodigos } }, select: { codigo: true } }))
      .map((x) => x.codigo)
  );

  let created = 0, updated = 0;
  const errors: ETLRowError[] = [];

  for (let i = 0; i < deduped.length; i += CHUNK_SIZE) {
    const chunk = deduped.slice(i, i + CHUNK_SIZE);
    try {
      const values = chunk.map((r) => {
        const codigo = String(r["CODIGO"]).trim();
        return Prisma.sql`(
          ${codigo},
          ${normalizeText(r["NOMBRE"]) ?? "(sin nombre)"},
          ${trim(r["CALC_RENT"])}
        )`;
      });

      await (prisma as unknown as { $executeRaw: (q: Prisma.Sql) => Promise<number> }).$executeRaw(Prisma.sql`
        INSERT INTO rubros_concepto_caja (codigo, nombre, "calcRent")
        VALUES ${Prisma.join(values)}
        ON CONFLICT (codigo) DO UPDATE SET
          nombre     = EXCLUDED.nombre,
          "calcRent" = EXCLUDED."calcRent"
          -- visibleEnDashboard: NO se sobreescribe (config manual del usuario)
      `);

      for (const r of chunk) {
        if (existingSet.has(String(r["CODIGO"]).trim())) updated++; else created++;
      }
    } catch (err) {
      errors.push({ rowIndex: i, rawCodigo: `chunk[${i}..${i + chunk.length - 1}] — primero: ${chunk[0]?.["CODIGO"]}`, message: err instanceof Error ? err.message : String(err) });
    }
  }

  return { created, updated, skipped, errors };
}
