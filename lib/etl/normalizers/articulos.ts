import { Prisma } from "@prisma/client";
import type { DbClient } from "../types";
import { trim } from "../helpers";
import type { ETLRow, ETLRowError } from "../types";
import { articuloRowSchema, type ArticuloRow } from "../schemas/articulos";
import { formatZodError } from "../schemas/common";
import { insertChunkWithRowFallback } from "../chunked-upsert";

const CHUNK_SIZE = 500;

export async function normalizeArticulos(
  rows: ETLRow[],
  prisma: DbClient
): Promise<{ created: number; updated: number; skipped: number; errors: ETLRowError[] }> {
  const errors: ETLRowError[] = [];
  let skipped = 0;

  // Dedup por CODIGO (last-wins) intencional para maestros.
  const parsedByCodigo = new Map<string, { data: ArticuloRow; idx: number }>();

  rows.forEach((r, idx) => {
    if (trim(r["CODIGO"]) == null) {
      skipped++;
      return;
    }
    const parsed = articuloRowSchema.safeParse(r);
    if (!parsed.success) {
      errors.push({ rowIndex: idx, rawCodigo: r["CODIGO"], message: formatZodError(parsed.error) });
      return;
    }
    parsedByCodigo.set(parsed.data.CODIGO, { data: parsed.data, idx });
  });

  const deduped = Array.from(parsedByCodigo.values());

  const allCodigos = deduped.map((d) => d.data.CODIGO);
  const existingSet = new Set(
    (await prisma.articulo.findMany({ where: { codigo: { in: allCodigos } }, select: { codigo: true } }))
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
          const codSua = data.COD_SUA != null && data.COD_SUA > 0 ? String(data.COD_SUA) : null;
          return Prisma.sql`(
            ${data.CODIGO},
            ${data.NOMBRE ?? "(sin nombre)"},
            ${data.PRECIO1}::numeric,
            ${data.PRECIO2}::numeric,
            ${data.PRECIO3}::numeric,
            ${data.PRECIO4}::numeric,
            ${codRua},
            ${codSua}
          )`;
        });

        return Prisma.sql`
          INSERT INTO articulos (codigo, nombre, precio1, precio2, precio3, precio4, "codRua", "codSua")
          VALUES ${Prisma.join(values)}
          ON CONFLICT (codigo) DO UPDATE SET
            nombre   = EXCLUDED.nombre,
            precio1  = EXCLUDED.precio1,
            precio2  = EXCLUDED.precio2,
            precio3  = EXCLUDED.precio3,
            precio4  = EXCLUDED.precio4,
            "codRua" = EXCLUDED."codRua",
            "codSua" = EXCLUDED."codSua"
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
