import { Prisma } from "@prisma/client";
import type { DbClient } from "../types";
import { trim } from "../helpers";
import type { ETLRow, ETLRowError } from "../types";
import { subrubroArticuloRowSchema, type SubrubroArticuloRow } from "../schemas/subrubros-articulo";
import { formatZodError } from "../schemas/common";
import { insertChunkWithRowFallback } from "../chunked-upsert";

const CHUNK_SIZE = 500;

export async function normalizeSubrubrosArticulo(
  rows: ETLRow[],
  prisma: DbClient
): Promise<{ created: number; updated: number; skipped: number; errors: ETLRowError[] }> {
  const errors: ETLRowError[] = [];
  let skipped = 0;

  const parsedByCodigo = new Map<string, { data: SubrubroArticuloRow; idx: number }>();

  rows.forEach((r, idx) => {
    if (trim(r["CODIGO"]) == null) {
      skipped++;
      return;
    }
    const parsed = subrubroArticuloRowSchema.safeParse(r);
    if (!parsed.success) {
      errors.push({ rowIndex: idx, rawCodigo: r["CODIGO"], message: formatZodError(parsed.error) });
      return;
    }
    parsedByCodigo.set(parsed.data.CODIGO, { data: parsed.data, idx });
  });

  const deduped = Array.from(parsedByCodigo.values());

  const allCodigos = deduped.map((d) => d.data.CODIGO);
  const existingSet = new Set(
    (await prisma.subrubroArticulo.findMany({ where: { codigo: { in: allCodigos } }, select: { codigo: true } }))
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
          const codRua = data.COD_RUA != null && data.COD_RUA > 0 ? String(data.COD_RUA) : null;
          return Prisma.sql`(
            ${data.CODIGO},
            ${data.NOMBRE ?? "(sin nombre)"},
            ${data.DELIACT},
            ${data.EVE_FOR},
            ${data.EVE_FORM},
            ${data.EVE_FORMH},
            ${data.FECHA_UPDA},
            ${codRua}
          )`;
        });

        return Prisma.sql`
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
