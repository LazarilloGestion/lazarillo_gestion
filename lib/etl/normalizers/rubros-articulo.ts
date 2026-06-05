import { Prisma } from "@prisma/client";
import type { DbClient } from "../types";
import { normalizeText, trim, toBool, toDecimal, toDecimalStr, excelDateToISO } from "../helpers";
import type { ETLRow, ETLRowError } from "../types";

const CHUNK_SIZE = 500;

export async function normalizeRubrosArticulo(
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
    (await prisma.rubroArticulo.findMany({ where: { codigo: { in: allCodigos } }, select: { codigo: true } }))
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
        return Prisma.sql`(
          ${codigo},
          ${normalizeText(r["NOMBRE"]) ?? "(sin nombre)"},
          ${trim(r["COLOR"])},
          ${trim(r["GRUPO_NRO"])},
          ${trim(r["GRUPO_COL"])},
          ${trim(r["GRUPO_FOT"])},
          ${toBool(r["EXCLUYEINF"])},
          ${trim(r["EVENTO"])},
          ${toBool(r["DELIACT"])},
          ${trim(r["EVE_FOR"])},
          ${trim(r["EVE_FORM"])},
          ${trim(r["EVE_FORMH"])},
          ${toDecimalStr(r["DISCONT"])}::numeric,
          ${fechaUpda},
          ${trim(r["MODO_VISTA"])}
        )`;
      });

      await (prisma as unknown as { $executeRaw: (q: Prisma.Sql) => Promise<number> }).$executeRaw(Prisma.sql`
        INSERT INTO rubros_articulo (
          codigo, nombre, color, "grupoNro", "grupoCol", "grupoFot",
          "excluyeInf", evento, "deliAct", "eveFor", "eveForm", "eveFormH",
          discont, "fechaUpda", "modoVista"
        )
        VALUES ${Prisma.join(values)}
        ON CONFLICT (codigo) DO UPDATE SET
          nombre        = EXCLUDED.nombre,
          color         = EXCLUDED.color,
          "grupoNro"    = EXCLUDED."grupoNro",
          "grupoCol"    = EXCLUDED."grupoCol",
          "grupoFot"    = EXCLUDED."grupoFot",
          "excluyeInf"  = EXCLUDED."excluyeInf",
          evento        = EXCLUDED.evento,
          "deliAct"     = EXCLUDED."deliAct",
          "eveFor"      = EXCLUDED."eveFor",
          "eveForm"     = EXCLUDED."eveForm",
          "eveFormH"    = EXCLUDED."eveFormH",
          discont       = EXCLUDED.discont,
          "fechaUpda"   = EXCLUDED."fechaUpda",
          "modoVista"   = EXCLUDED."modoVista"
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
