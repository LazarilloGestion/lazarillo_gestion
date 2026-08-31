/**
 * limpiar-flujo-caja-cero.ts
 *
 * Borra las filas de flujo_caja_manual con monto = 0. Un arqueo en $0 es "sin dato"
 * (ver docs/superpowers/specs/2026-08-31-arqueo-cero-no-es-dato-design.md): no debería
 * existir como fila. Estas filas quedaron de un camino de escritura viejo que persistía
 * $0 al guardar una celda vacía.
 *
 * Dry-run por defecto (solo reporta). Requiere --apply para borrar contra la base real.
 *
 * Uso:
 *   npx tsx scripts/limpiar-flujo-caja-cero.ts            # dry-run
 *   npx tsx scripts/limpiar-flujo-caja-cero.ts --apply     # aplica el borrado
 */

import { fileURLToPath } from "url";
import { config } from "dotenv";
config({ path: ".env.local" });

import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";

export interface FilaCero {
  localId: number | null;
  puntoDeVentaId: number | null;
  anio: number;
  mes: number;
}

export function resumirFilasCero(rows: FilaCero[]): string {
  if (rows.length === 0) return "0 filas con monto = 0 — nada que borrar.";
  const lineas = rows
    .map((r) => {
      const local = r.localId != null ? `local ${r.localId}` : "local —";
      const pdv = r.puntoDeVentaId != null ? `pdv ${r.puntoDeVentaId}` : "pdv —";
      const periodo = `${r.anio}-${String(r.mes).padStart(2, "0")}`;
      return `  ${local}, ${pdv}, ${periodo}`;
    })
    .join("\n");
  return `${rows.length} filas con monto = 0:\n${lineas}`;
}

async function main() {
  const apply = process.argv.includes("--apply");

  const rows = await prisma.$queryRaw<FilaCero[]>(Prisma.sql`
    SELECT "localId", "puntoDeVentaId", "anio", "mes"
    FROM "flujo_caja_manual"
    WHERE "monto" = 0
    ORDER BY "localId", "puntoDeVentaId", "anio", "mes"
  `);

  console.log(resumirFilasCero(rows));

  if (!apply) {
    console.log("\nDry-run. Volvé a correr con --apply para borrar.");
    return;
  }

  if (rows.length === 0) return;

  const borradas = await prisma.$executeRaw(Prisma.sql`
    DELETE FROM "flujo_caja_manual" WHERE "monto" = 0
  `);
  console.log(`\nBorradas ${borradas} filas.`);

  const quedan = await prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`
    SELECT count(*) AS n FROM "flujo_caja_manual" WHERE "monto" = 0
  `);
  if (Number(quedan[0].n) !== 0) {
    throw new Error(`Post-borrado: todavía quedan ${quedan[0].n} filas con monto = 0`);
  }
  console.log("Verificado: 0 filas con monto = 0.");
}

const esEntrypointCli = process.argv[1] === fileURLToPath(import.meta.url);

if (esEntrypointCli) {
  main()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
