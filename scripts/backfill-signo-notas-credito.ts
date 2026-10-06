/**
 * backfill-signo-notas-credito.ts
 *
 * El ERP exporta las notas de crédito electrónicas (NcA/NcB/NcC) con importe positivo, y el
 * ETL las guardaba tal cual (ver lib/etl/normalizers/nota-credito.ts). Este script invierte a
 * negativo las que ya están en la base, para que no dependan de un reimport del Excel histórico.
 *
 * Omite (y reporta) dos casos que requieren decisión humana:
 *  - NC distribuida: tiene apertura de gastos aplicada; las distribuciones guardan importes
 *    positivos, así que hay que re-evaluar la regla desde la UI después de invertir la compra.
 *  - NC con importe manual: el override del usuario manda, no se pisa.
 *
 * Dry-run por defecto (solo reporta). Requiere --apply para modificar la base real.
 *
 * Uso:
 *   npx tsx scripts/backfill-signo-notas-credito.ts            # dry-run
 *   npx tsx scripts/backfill-signo-notas-credito.ts --apply     # aplica
 */

import { fileURLToPath } from "url";
import { config } from "dotenv";
config({ path: ".env.local" });

import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { esNotaCredito } from "../lib/etl/normalizers/nota-credito";

export interface CompraNcCandidata {
  rowId: string;
  fecha: string | null;
  detalle: string | null;
  importe: string;
  esDistribuido: boolean;
  importeManual: string | null;
}

export type MotivoOmision = "distribuida" | "importe_manual";

export interface PlanBackfill {
  invertir: CompraNcCandidata[];
  omitidas: (CompraNcCandidata & { motivo: MotivoOmision })[];
}

// La regla "qué es una NC" vive en esNotaCredito (una sola fuente de verdad con el ETL);
// el SQL de abajo solo preselecciona de forma amplia.
export function planificarBackfill(filas: CompraNcCandidata[]): PlanBackfill {
  const plan: PlanBackfill = { invertir: [], omitidas: [] };
  for (const f of filas) {
    if (!esNotaCredito(f.detalle) || !(Number(f.importe) > 0)) continue;
    if (f.esDistribuido) plan.omitidas.push({ ...f, motivo: "distribuida" });
    else if (f.importeManual != null) plan.omitidas.push({ ...f, motivo: "importe_manual" });
    else plan.invertir.push(f);
  }
  return plan;
}

export function resumirPlan(plan: PlanBackfill): string {
  if (plan.invertir.length === 0 && plan.omitidas.length === 0) {
    return "0 notas de crédito con importe positivo — nada que invertir.";
  }
  const total = plan.invertir.reduce((acc, f) => acc.plus(f.importe), new Prisma.Decimal(0));
  const lineas = [`${plan.invertir.length} notas de crédito a invertir (suma ${total.toString()}):`];
  for (const f of plan.invertir) lineas.push(`  ${f.fecha ?? "—"}  ${f.detalle}  ${new Prisma.Decimal(f.importe).toString()}`);
  if (plan.omitidas.length > 0) {
    lineas.push(`\n${plan.omitidas.length} omitidas (requieren decisión manual):`);
    for (const f of plan.omitidas) lineas.push(`  ${f.fecha ?? "—"}  ${f.detalle}  ${new Prisma.Decimal(f.importe).toString()}  [${f.motivo}]`);
  }
  return lineas.join("\n");
}

async function main() {
  const apply = process.argv.includes("--apply");

  const candidatas = await prisma.$queryRaw<CompraNcCandidata[]>(Prisma.sql`
    SELECT "rowId", to_char(fecha, 'YYYY-MM-DD') AS fecha, detalle, importe::text AS importe,
           "esDistribuido", "importeManual"::text AS "importeManual"
    FROM compras
    WHERE detalle ILIKE 'nc%' AND importe > 0
    ORDER BY fecha, "rowId"
  `);
  const plan = planificarBackfill(candidatas);

  console.log(resumirPlan(plan));

  if (!apply) {
    console.log("\nDry-run. Volvé a correr con --apply para invertir.");
    return;
  }
  if (plan.invertir.length === 0) return;

  // Transacción interactiva: si alguna fila no actualiza exactamente 1 registro (cambió entre el
  // dry-run y ahora), se revierte todo en vez de dejar el lote a medias. Los AND repiten las
  // condiciones del plan como seguro contra cambios concurrentes.
  await prisma.$transaction(async (tx) => {
    for (const f of plan.invertir) {
      const n = await tx.$executeRaw(Prisma.sql`
        UPDATE compras
        SET importe = -abs(importe), "importeTrabajado" = -abs("importeTrabajado")
        WHERE "rowId" = ${f.rowId} AND importe > 0 AND "esDistribuido" = false AND "importeManual" IS NULL
      `);
      if (n !== 1) throw new Error(`UPDATE de ${f.rowId} (${f.detalle}) afectó ${n} filas, se esperaba 1 — transacción revertida`);
    }
  });
  console.log(`\nInvertidas ${plan.invertir.length} notas de crédito.`);

  const restantes = planificarBackfill(
    await prisma.$queryRaw<CompraNcCandidata[]>(Prisma.sql`
      SELECT "rowId", to_char(fecha, 'YYYY-MM-DD') AS fecha, detalle, importe::text AS importe,
             "esDistribuido", "importeManual"::text AS "importeManual"
      FROM compras WHERE detalle ILIKE 'nc%' AND importe > 0
    `),
  );
  if (restantes.invertir.length !== 0) {
    throw new Error(`Post-backfill: todavía quedan ${restantes.invertir.length} NC positivas invertibles`);
  }
  console.log(`Verificado: 0 NC positivas pendientes de invertir (${restantes.omitidas.length} omitidas a propósito).`);
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
