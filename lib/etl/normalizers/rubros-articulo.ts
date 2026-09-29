import { Prisma } from "@prisma/client";
import type { DbClient } from "../types";
import { trim } from "../helpers";
import type { ETLRow, ETLRowError } from "../types";
import { rubroArticuloRowSchema, type RubroArticuloRow } from "../schemas/rubros-articulo";
import { formatZodError } from "../schemas/common";
import { insertChunkWithRowFallback } from "../chunked-upsert";

const CHUNK_SIZE = 500;

export async function normalizeRubrosArticulo(
  rows: ETLRow[],
  prisma: DbClient
): Promise<{ created: number; updated: number; skipped: number; errors: ETLRowError[] }> {
  const errors: ETLRowError[] = [];
  let skipped = 0;

  const parsedByCodigo = new Map<string, { data: RubroArticuloRow; idx: number }>();

  rows.forEach((r, idx) => {
    if (trim(r["CODIGO"]) == null) {
      skipped++;
      return;
    }
    const parsed = rubroArticuloRowSchema.safeParse(r);
    if (!parsed.success) {
      errors.push({ rowIndex: idx, rawCodigo: r["CODIGO"], message: formatZodError(parsed.error) });
      return;
    }
    parsedByCodigo.set(parsed.data.CODIGO, { data: parsed.data, idx });
  });

  const deduped = Array.from(parsedByCodigo.values());

  const allCodigos = deduped.map((d) => d.data.CODIGO);
  const existingSet = new Set(
    (await prisma.rubroArticulo.findMany({ where: { codigo: { in: allCodigos } }, select: { codigo: true } }))
      .map((x) => x.codigo)
  );

  let created = 0, updated = 0;

  for (let i = 0; i < deduped.length; i += CHUNK_SIZE) {
    const chunk = deduped.slice(i, i + CHUNK_SIZE);

    const chunkErrors = await insertChunkWithRowFallback(
      prisma,
      chunk,
      (rowsToInsert) => {
        const values = rowsToInsert.map(({ data }) => {
          return Prisma.sql`(
            ${data.CODIGO},
            ${data.NOMBRE ?? "(sin nombre)"},
            ${data.COLOR},
            ${data.GRUPO_NRO},
            ${data.GRUPO_COL},
            ${data.GRUPO_FOT},
            ${data.EXCLUYEINF},
            ${data.EVENTO},
            ${data.DELIACT},
            ${data.EVE_FOR},
            ${data.EVE_FORM},
            ${data.EVE_FORMH},
            ${data.DISCONT}::numeric,
            ${data.FECHA_UPDA},
            ${data.MODO_VISTA}
          )`;
        });

        return Prisma.sql`
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
        `;
      },
      ({ data, idx }, err) => ({
        rowIndex: idx,
        rawCodigo: data.CODIGO,
        message: err instanceof Error ? err.message : String(err),
      }),
      (insertedRows) => {
        for (const { data } of insertedRows) {
          if (existingSet.has(data.CODIGO)) updated++; else created++;
        }
      }
    );
    errors.push(...chunkErrors);
  }

  return { created, updated, skipped, errors };
}
