import { Prisma } from "@prisma/client";
import type { DbClient } from "../types";
import { trim } from "../helpers";
import type { ETLRow, ETLRowError } from "../types";
import { conceptoCajaRowSchema, type ConceptoCajaRow } from "../schemas/conceptos-caja";
import { formatZodError } from "../schemas/common";

const CHUNK_SIZE = 500;

export async function normalizeConceptosCaja(
  rows: ETLRow[],
  prisma: DbClient
): Promise<{ created: number; updated: number; skipped: number; errors: ETLRowError[] }> {
  const errors: ETLRowError[] = [];
  let skipped = 0;

  const parsedByCodigo = new Map<string, ConceptoCajaRow>();

  rows.forEach((r, idx) => {
    if (trim(r["CODIGO"]) == null) {
      skipped++;
      return;
    }
    const parsed = conceptoCajaRowSchema.safeParse(r);
    if (!parsed.success) {
      errors.push({ rowIndex: idx, rawCodigo: r["CODIGO"], message: formatZodError(parsed.error) });
      return;
    }
    parsedByCodigo.set(parsed.data.CODIGO, parsed.data);
  });

  const deduped = Array.from(parsedByCodigo.values());

  const allCodigos = deduped.map((d) => d.CODIGO);
  const existingSet = new Set(
    (await prisma.conceptoCaja.findMany({ where: { codigo: { in: allCodigos } }, select: { codigo: true } }))
      .map((x) => x.codigo)
  );

  const allCodRga = [...new Set(
    deduped.map((d) => (d.COD_RGA != null && d.COD_RGA > 0 ? String(d.COD_RGA) : null)).filter((v): v is string => v != null)
  )];
  const validRgaSet = new Set(
    (await prisma.rubroConceptoCaja.findMany({ where: { codigo: { in: allCodRga } }, select: { codigo: true } }))
      .map((x) => x.codigo)
  );

  let created = 0, updated = 0;

  for (let i = 0; i < deduped.length; i += CHUNK_SIZE) {
    const chunk = deduped.slice(i, i + CHUNK_SIZE);
    try {
      const values = chunk.map((data) => {
        const rawRga = data.COD_RGA != null && data.COD_RGA > 0 ? String(data.COD_RGA) : null;
        const codRga = rawRga != null && (validRgaSet.size === 0 || validRgaSet.has(rawRga)) ? rawRga : null;
        return Prisma.sql`(
          ${data.CODIGO},
          ${data.NOMBRE ?? "(sin nombre)"},
          ${data.TIPO},
          ${data.COD_IMP},
          ${codRga}
        )`;
      });

      await prisma.$executeRaw(Prisma.sql`
        INSERT INTO conceptos_caja (codigo, nombre, tipo, "codImp", "codRga")
        VALUES ${Prisma.join(values)}
        ON CONFLICT (codigo) DO UPDATE SET
          nombre    = EXCLUDED.nombre,
          tipo      = EXCLUDED.tipo,
          "codImp"  = EXCLUDED."codImp",
          "codRga"  = EXCLUDED."codRga"
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
