import * as fs from "fs";
import * as path from "path";
import { config } from "dotenv";

config({ path: path.join(process.cwd(), ".env") });

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

const SEED_DIR =
  process.env.SEED_DIR ??
  path.join(process.env.HOME!, "Downloads", "Diego Albo", "seedsVersion1");

// Orden FK-safe
const FILES = [
  "rubrosConceptosDeCajaV7.XLSX",
  "rubrosDeArticulosV7.XLSX",
  "subrubroDe ArticulosV7.XLSX",
  "conceptosDeCajaV7.XLSX",
  "listadoDeArticulosV7.XLSX",
  "proovedoresV7.XLSX",
];

async function main() {
  console.log("=== Test ETL Motor ===\n");
  console.log(`Leyendo desde: ${SEED_DIR}\n`);

  for (const filename of FILES) {
    const filePath = path.join(SEED_DIR, filename);
    if (!fs.existsSync(filePath)) {
      console.warn(`  [SKIP] No encontrado: ${filename}`);
      continue;
    }

    const buffer = fs.readFileSync(filePath);
    const headers = getExcelHeaders(buffer);
    const fileType = detectFileType(headers);

    if (!fileType) {
      console.error(`  [ERROR] Tipo no detectado: ${filename}`);
      console.error(`  Headers: ${headers.join(", ")}`);
      continue;
    }

    console.log(`→ ${filename}`);
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
      if (errors.length > 3) {
        console.error(`    ... y ${errors.length - 3} errores más`);
      }
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
