#!/usr/bin/env npx tsx
/**
 * Re-procesa archivos desde Supabase Storage bucket "seeds".
 * Uso: npx tsx scripts/reprocess-seeds.ts
 */
import { createClient } from "@supabase/supabase-js";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { runETL } from "../lib/etl/run-etl";
import { getExcelHeaders } from "../lib/etl/helpers";
import { detectFileType } from "../lib/etl/detect-file-type";
import type { DbClient } from "../lib/etl/types";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const DIRECT_URL = process.env.DIRECT_URL ?? process.env.DATABASE_URL!;

const DEPENDENCY_ORDER = [
  "rubrosConceptoCaja",
  "rubrosArticulo",
  "subrubrosArticulo",
  "conceptosCaja",
  "articulos",
  "proveedores",
  "compras",
  "detalleCompras",
  "ventas",
];

// Paths a re-procesar. Ajustar según necesidad.
const PATHS_TO_REPROCESS = [
  "transaccionales/version_1/comprasDetalleDeCompras2026_V7.XLSX",
  "transaccionales/version_1/gastosComprasDetalladoCanchas_2025_V7.XLSX",
];

async function main() {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DIRECT_URL }) });

  type Entry = { path: string; buffer: Buffer; fileType: string; order: number };
  const entries: Entry[] = [];

  console.log("Descargando archivos desde storage...");
  for (const path of PATHS_TO_REPROCESS) {
    const { data, error } = await supabase.storage.from("seeds").download(path);
    if (error || !data) {
      console.error(`✗ No se pudo descargar "${path}":`, error?.message);
      process.exit(1);
    }
    const buffer = Buffer.from(await data.arrayBuffer());
    const headers = getExcelHeaders(buffer);
    const fileType = detectFileType(headers);
    if (!fileType) {
      console.error(`✗ Tipo no detectado para "${path}". Headers: ${headers.join(", ")}`);
      process.exit(1);
    }
    const order = DEPENDENCY_ORDER.indexOf(fileType);
    entries.push({ path, buffer, fileType, order: order === -1 ? 999 : order });
    console.log(`  ✓ ${path} → ${fileType}`);
  }

  entries.sort((a, b) => a.order - b.order);

  console.log("\nProcesando en orden de dependencia FK...");
  for (const { path, buffer, fileType } of entries) {
    console.log(`\n→ ${fileType} (${path})`);
    try {
      const report = await prisma.$transaction(
        async (tx) => runETL(buffer, path, {}, tx as unknown as DbClient),
        { timeout: 300_000 }
      );
      console.log(
        `  ✓ created: ${report.created}  updated: ${report.updated}  skipped: ${report.skipped}  errors: ${report.errors.length}  (${report.durationMs}ms)`
      );
      if (report.errors.length > 0) {
        report.errors.slice(0, 5).forEach((e) => console.warn("    ⚠", e));
      }
    } catch (err) {
      console.error(`  ✗ Error:`, err instanceof Error ? err.message : err);
      process.exit(1);
    }
  }

  console.log("\nPost-batch: linkeando detalle_compras → compras...");
  const result = await prisma.$executeRaw`
    UPDATE detalle_compras dc
    SET "compraId" = c."rowId"
    FROM compras c
    WHERE dc.comprobante = c.comprobante
      AND dc."compraId" IS NULL
  `;
  console.log(`  ✓ ${result} filas linkeadas`);

  await prisma.$disconnect();
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
