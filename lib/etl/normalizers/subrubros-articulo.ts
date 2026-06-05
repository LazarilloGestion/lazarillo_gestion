import { Prisma } from "@prisma/client";
import type { DbClient } from "../types";
import { normalizeText, trim, toBool, excelDateToISO } from "../helpers";
import type { ETLRow, ETLRowError } from "../types";

const CHUNK_SIZE = 500;

export async function normalizeSubrubrosArticulo(
  rows: ETLRow[],
  prisma: DbClient
): Promise<{ created: number; updated: number; skipped: number; errors: ETLRowError[] }> {
  const filtered = rows.filter((r) => trim(r["CODIGO"]) != null);
  const skipped = rows.length - filtered.length;

  const deduped = Array.from(
    filtered.reduce((m, r) => m.set(String(r["CODIGO"]).trim(), r), new Map<string, ETLRow>()).values()
  );

  const allCodigos = deduped.map((r) => String(r["CODIGO"]).trim());
  const existingSet = new Set(
    (await prisma.subrubroArticulo.findMany({ where: { codigo: { in: allCodigos } }, select: { codigo: true } }))
      .map((x) => x.codigo)
  );

  let created = 0, updated = 0;
  const errors: ETLRowError[] = [];

  for (let i = 0; i < deduped.length; i += CHUNK_SIZE) {
    const chunk = deduped.slice(i, i + CHUNK_SIZE);
    try {
      const values = chunk.map((r) => {
        const codigo = String(r["CODIGO"]).trim();
        const fechaRaw = excelDateToISO(r["FECHA_UPDA"]);
        const fechaUpda = fechaRaw ? new Date(fechaRaw) : null;
        const codRua = r["COD_RUA"] != null && Number(r["COD_RUA"]) > 0 ? String(r["COD_RUA"]) : null;
        return Prisma.sql`(
          ${codigo},
          ${normalizeText(r["NOMBRE"]) ?? "(sin nombre)"},
          ${toBool(r["DELIACT"])},
          ${trim(r["EVE_FOR"])},
          ${trim(r["EVE_FORM"])},
          ${trim(r["EVE_FORMH"])},
          ${fechaUpda},
          ${codRua}
        )`;
      });

      await (prisma as unknown as { $executeRaw: (q: Prisma.Sql) => Promise<number> }).$executeRaw(Prisma.sql`
        INSERT INTO subrubros_articulo (
          codigo, nombre, "deliAct", "eveFor", "eveForm", "eveFormH", "fechaUpda", "codRua"
        )
        VALUES ${Prisma.join(values)}
        ON CONFLICT (codigo) DO UPDATE SET
          nombre      = EXCLUDED.nombre,
          "deliAct"   = EXCLUDED."deliAct",
          "eveFor"    = EXCLUDED."eveFor",
          "eveForm"   = EXCLUDED."eveForm",
          "eveFormH"  = EXCLUDED."eveFormH",
          "fechaUpda" = EXCLUDED."fechaUpda",
          "codRua"    = EXCLUDED."codRua"
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
