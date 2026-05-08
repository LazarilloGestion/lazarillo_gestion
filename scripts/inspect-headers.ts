import * as path from "path";
import { config } from "dotenv";

config({ path: path.join(process.cwd(), ".env") });
config({ path: path.join(process.cwd(), ".env.local"), override: true });

import { createClient } from "@supabase/supabase-js";
import { getExcelHeaders } from "../lib/etl/helpers";

const BUCKET = "seeds";
const FOLDER = process.argv[2] ?? "transaccionales/version_1";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  const { data: files, error } = await supabase.storage
    .from(BUCKET)
    .list(FOLDER, { sortBy: { column: "name", order: "asc" } });

  if (error) { console.error("list error:", error.message); process.exit(1); }

  const xlsxFiles = (files ?? []).filter((f) => f.name.match(/\.(xlsx|xls)$/i));
  console.log(`${xlsxFiles.length} archivos en ${BUCKET}/${FOLDER}\n`);

  for (const file of xlsxFiles) {
    const { data, error: dlErr } = await supabase.storage
      .from(BUCKET)
      .download(`${FOLDER}/${file.name}`);

    if (dlErr || !data) {
      console.log(`${file.name}: ERROR ${dlErr?.message}`);
      continue;
    }

    const buffer = Buffer.from(await data.arrayBuffer());
    const headers = getExcelHeaders(buffer);
    console.log(`=== ${file.name} ===`);
    console.log(headers.map((h, i) => `  [${i}] ${h}`).join("\n"));
    console.log();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
