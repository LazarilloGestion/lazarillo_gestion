import * as path from "path";
import { config } from "dotenv";

config({ path: path.join(process.cwd(), ".env") });
config({ path: path.join(process.cwd(), ".env.local"), override: true });

import { createClient } from "@supabase/supabase-js";
import type { ETLContext, ETLReport } from "../lib/etl/types";

const BUCKET = "seeds";

// Contexto por carpeta: qué local/puntoDeVenta se asigna a los transaccionales
const FOLDER_CONFIG: { folder: string; ctx?: ETLContext }[] = [
  { folder: "maestros/version_1" },
  { folder: "transaccionales/version_1", ctx: { localId: 2, puntoDeVentaId: 3 } }, // San Justo / Canchas
];

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type RunETL = (buffer: Buffer, storagePath?: string, ctx?: ETLContext) => Promise<ETLReport>;

async function processFolder(folder: string, runETL: RunETL, ctx?: ETLContext) {
  console.log(`\n=== ${BUCKET}/${folder} ===`);
  if (ctx) console.log(`    ctx: localId=${ctx.localId} puntoDeVentaId=${ctx.puntoDeVentaId}`);
  console.log();

  const { data: files, error: listError } = await supabase.storage
    .from(BUCKET)
    .list(folder, { sortBy: { column: "name", order: "asc" } });

  if (listError) {
    console.error("Error listando archivos:", listError.message);
    return;
  }

  const xlsxFiles = (files ?? []).filter((f) =>
    f.name.match(/\.(xlsx|xls)$/i)
  );

  if (xlsxFiles.length === 0) {
    console.warn("Sin archivos Excel.");
    return;
  }

  console.log(`${xlsxFiles.length} archivos encontrados:\n`);

  for (const file of xlsxFiles) {
    const filePath = `${folder}/${file.name}`;
    console.log(`→ ${file.name}`);

    const { data, error } = await supabase.storage
      .from(BUCKET)
      .download(filePath);

    if (error || !data) {
      console.error(`  [ERROR] No se pudo descargar: ${error?.message}`);
      continue;
    }

    const buffer = Buffer.from(await data.arrayBuffer());

    try {
      const report = await runETL(buffer, undefined, ctx);
      console.log(
        `  Tipo: ${report.fileType} | total: ${report.totalRows} | creados: ${report.created} | actualizados: ${report.updated} | omitidos: ${report.skipped} | errores: ${report.errors.length} | ${report.durationMs}ms`
      );
      if (report.errors.length > 0) {
        report.errors.slice(0, 3).forEach((e) =>
          console.error(`    [fila ${e.rowIndex}] codigo:${e.rawCodigo} — ${e.message}`)
        );
        if (report.errors.length > 3)
          console.error(`    ... y ${report.errors.length - 3} más`);
      }
    } catch (err) {
      console.error(`  [ERROR] ${err instanceof Error ? err.message : String(err)}`);
    }

    console.log();
  }
}

async function main() {
  console.log("=== Test ETL desde Supabase Storage ===");

  // Dynamic import para que lib/prisma.ts se instancie DESPUÉS de dotenv
  const { runETL } = await import("../lib/etl/run-etl");

  for (const { folder, ctx } of FOLDER_CONFIG) {
    await processFolder(folder, runETL, ctx);
  }

  console.log("✓ Listo.");
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
