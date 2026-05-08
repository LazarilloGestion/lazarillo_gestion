import * as path from "path";
import { config } from "dotenv";

config({ path: path.join(process.cwd(), ".env") });
config({ path: path.join(process.cwd(), ".env.local"), override: true });

import { createClient } from "@supabase/supabase-js";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { getExcelHeaders, readExcelBuffer } from "../lib/etl/helpers";
import { detectFileType } from "../lib/etl/detect-file-type";
import { normalizeRubrosConceptoCaja } from "../lib/etl/normalizers/rubros-concepto-caja";
import { normalizeRubrosArticulo } from "../lib/etl/normalizers/rubros-articulo";
import { normalizeSubrubrosArticulo } from "../lib/etl/normalizers/subrubros-articulo";
import { normalizeConceptosCaja } from "../lib/etl/normalizers/conceptos-caja";
import { normalizeArticulos } from "../lib/etl/normalizers/articulos";
import { normalizeProveedores } from "../lib/etl/normalizers/proveedores";

const BUCKET = "seeds";
const FOLDER = "maestros/version_1";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const NORMALIZERS = {
  rubrosConceptoCaja: normalizeRubrosConceptoCaja,
  rubrosArticulo: normalizeRubrosArticulo,
  subrubrosArticulo: normalizeSubrubrosArticulo,
  conceptosCaja: normalizeConceptosCaja,
  articulos: normalizeArticulos,
  proveedores: normalizeProveedores,
} as const;

async function main() {
  console.log("=== Test ETL desde Supabase Storage ===\n");
  console.log(`Bucket: ${BUCKET} / ${FOLDER}\n`);

  const { data: files, error: listError } = await supabase.storage
    .from(BUCKET)
    .list(FOLDER, { sortBy: { column: "name", order: "asc" } });

  if (listError) {
    console.error("Error listando archivos:", listError.message);
    process.exit(1);
  }

  const xlsxFiles = (files ?? []).filter((f) =>
    f.name.match(/\.(xlsx|xls)$/i)
  );

  if (xlsxFiles.length === 0) {
    console.warn("No se encontraron archivos Excel en la carpeta.");
    process.exit(0);
  }

  console.log(`${xlsxFiles.length} archivos encontrados:\n`);

  for (const file of xlsxFiles) {
    const filePath = `${FOLDER}/${file.name}`;
    console.log(`→ ${file.name}`);

    const { data, error } = await supabase.storage
      .from(BUCKET)
      .download(filePath);

    if (error || !data) {
      console.error(`  [ERROR] No se pudo descargar: ${error?.message}`);
      continue;
    }

    const buffer = Buffer.from(await data.arrayBuffer());
    const headers = getExcelHeaders(buffer);
    const fileType = detectFileType(headers);

    if (!fileType) {
      console.error(`  [ERROR] Tipo no detectado. Headers: ${headers.join(", ")}`);
      continue;
    }

    console.log(`  Tipo detectado: ${fileType}`);

    const startMs = Date.now();
    const rows = readExcelBuffer(buffer);
    const normalizer = NORMALIZERS[fileType];
    const { created, updated, skipped, errors } = await normalizer(rows, prisma);
    const durationMs = Date.now() - startMs;

    console.log(
      `  total: ${rows.length} | creados: ${created} | actualizados: ${updated} | omitidos: ${skipped} | errores: ${errors.length} | ${durationMs}ms`
    );

    if (errors.length > 0) {
      errors.slice(0, 3).forEach((e) =>
        console.error(`    [fila ${e.rowIndex}] codigo:${e.rawCodigo} — ${e.message}`)
      );
      if (errors.length > 3) console.error(`    ... y ${errors.length - 3} más`);
    }

    console.log();
  }

  console.log("✓ Listo.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
