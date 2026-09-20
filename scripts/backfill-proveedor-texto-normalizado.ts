/**
 * backfill-proveedor-texto-normalizado.ts
 *
 * Completa compras.proveedorTextoNormalizado para las filas ya importadas con
 * proveedorId IS NULL (el ETL, desde este plan en adelante, ya lo calcula para
 * los imports nuevos — ver lib/etl/normalizers/compras.ts). Siempre recalculable
 * desde compras.proveedor: a diferencia de fix-proveedorid-cruzado.ts, este
 * script no borra ni corrige nada existente, solo completa una columna nueva.
 *
 * Por defecto corre en modo dry-run (solo reporta el plan, no escribe nada).
 * Requiere --apply para ejecutar contra la base real.
 *
 * Uso:
 *   npx tsx scripts/backfill-proveedor-texto-normalizado.ts                          # dry-run
 *   npx tsx scripts/backfill-proveedor-texto-normalizado.ts --apply                  # aplica de verdad
 *   npx tsx scripts/backfill-proveedor-texto-normalizado.ts --apply --esperadas=<N>
 *
 * <N> es el conteo que el humano aprobó en la corrida de dry-run inmediatamente
 * anterior — cambia con cada import nuevo, no hay un valor correcto fijo.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { fileURLToPath } from "url";
import * as path from "path";
import { prisma } from "../lib/prisma";
import { normalizarProveedorTexto } from "../lib/text-normalize";

const SCRATCHPAD_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "tmp", "backfill-proveedor-texto-normalizado");

export interface CompraParaBackfill {
  rowId: string;
  proveedorId: number | null;
  proveedor: string | null;
}

export interface ActualizacionBackfill {
  rowId: string;
  proveedorTextoNormalizado: string;
}

export interface PlanBackfillProveedorTexto {
  actualizaciones: ActualizacionBackfill[];
}

// Función pura, testable sin base de datos real — mismo criterio de separación
// que planFixProveedorCruzado (fix-proveedorid-cruzado.ts). Reusa
// normalizarProveedorTexto (lib/text-normalize.ts) en vez de reimplementar el
// fallback "Sin Proveedor" acá — es la 3ra ruta que lo necesita (ETL,
// reevaluacion.ts, y este script), así que se extrajo para no repetirlo.
export function planBackfillProveedorTexto(compras: CompraParaBackfill[]): PlanBackfillProveedorTexto {
  const actualizaciones = compras
    .filter((c) => c.proveedorId == null)
    .map((c) => ({
      rowId: c.rowId,
      proveedorTextoNormalizado: normalizarProveedorTexto(c.proveedor),
    }));
  return { actualizaciones };
}

// Un updateMany por FILA contra la base real proyectaba ~800s (medido: ~59ms de
// round-trip por statement × ~14.000 filas), muy por encima de cualquier timeout
// de transacción razonable — el --apply nunca podría terminar. Los valores
// distintos de proveedorTextoNormalizado son ~173, así que agrupar por valor
// convierte ~14.000 statements en ~173.
export function agruparPorTextoNormalizado(actualizaciones: ActualizacionBackfill[]): Map<string, string[]> {
  const porValor = new Map<string, string[]>();
  for (const { rowId, proveedorTextoNormalizado } of actualizaciones) {
    const rowIds = porValor.get(proveedorTextoNormalizado) ?? [];
    rowIds.push(rowId);
    porValor.set(proveedorTextoNormalizado, rowIds);
  }
  return porValor;
}

function parsearEsperadas(argv: string[]): number | null {
  const arg = argv.find((a) => a.startsWith("--esperadas="));
  if (!arg) return null;
  const valor = Number(arg.slice("--esperadas=".length));
  if (!Number.isInteger(valor) || valor < 0) {
    throw new Error(`--esperadas debe ser un entero no negativo, se recibió "${arg}"`);
  }
  return valor;
}

async function exportarDetalle(actualizaciones: ActualizacionBackfill[], archivo: string) {
  const fs = await import("fs");
  fs.mkdirSync(path.dirname(archivo), { recursive: true });
  fs.writeFileSync(archivo, JSON.stringify(actualizaciones, null, 2));
  return archivo;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const esperadas = parsearEsperadas(process.argv);

  const compras: CompraParaBackfill[] = await prisma.compra.findMany({
    where: { proveedorId: null },
    select: { rowId: true, proveedorId: true, proveedor: true },
  });
  const plan = planBackfillProveedorTexto(compras);

  console.log(`\n=== Plan de backfill de proveedorTextoNormalizado (${apply ? "aplicando" : "dry-run"}) ===`);
  console.log(`Compras con proveedorId null: ${compras.length}`);
  console.log(`Filas a completar: ${plan.actualizaciones.length}`);
  console.log(`Valores distintos de proveedorTextoNormalizado (updateMany a emitir): ${agruparPorTextoNormalizado(plan.actualizaciones).size}`);

  if (!apply) {
    const archivoDryRun = await exportarDetalle(plan.actualizaciones, `${SCRATCHPAD_DIR}/backfill-dry-run.json`);
    console.log(`Detalle exportado a ${archivoDryRun}`);
    console.log("\nDry-run — no se escribió nada en la base. Re-ejecutar con --apply para aplicar.\n");
    return;
  }

  console.log("\nAplicando...");

  const comprasEnVivo: CompraParaBackfill[] = await prisma.compra.findMany({
    where: { proveedorId: null },
    select: { rowId: true, proveedorId: true, proveedor: true },
  });
  const planEnVivo = planBackfillProveedorTexto(comprasEnVivo);

  if (planEnVivo.actualizaciones.length !== plan.actualizaciones.length) {
    throw new Error(
      `Plan cambió entre el resumen mostrado y la ejecución: se esperaba completar ${plan.actualizaciones.length} filas, ` +
        `pero el recálculo en vivo encontró ${planEnVivo.actualizaciones.length}`
    );
  }

  if (esperadas !== null && planEnVivo.actualizaciones.length !== esperadas) {
    throw new Error(
      `--esperadas=${esperadas} no coincide con el recálculo en vivo: se encontraron ${planEnVivo.actualizaciones.length} filas. ` +
        `La base pudo haber cambiado desde el dry-run aprobado — abortando sin escribir nada.`
    );
  }

  if (planEnVivo.actualizaciones.length === 0) {
    console.log("\nNo hay nada para completar.\n");
    return;
  }

  // La verificación de conteo va DENTRO del callback (no después del
  // await prisma.$transaction(...)): si no matchea, el throw hace que la
  // transacción entera rechace y Prisma haga rollback, en vez de dejar
  // confirmada una escritura parcial (mismo patrón que fix-proveedorid-cruzado.ts,
  // I-review Task 7).
  const porValor = agruparPorTextoNormalizado(planEnVivo.actualizaciones);
  console.log(`Grupos a actualizar (un updateMany por valor): ${porValor.size}`);

  let actualizadas = 0;
  // timeout de 120s: ~173 statements × ~59ms medidos ≈ 10s de round-trips, más
  // el costo del update en sí. Margen amplio a propósito — el escenario malo no
  // es tardar de más, es que un pico de latencia haga fallar el único --apply
  // que un humano autorizó.
  await prisma.$transaction(async (tx) => {
    for (const [proveedorTextoNormalizado, rowIds] of porValor) {
      const resultado = await tx.compra.updateMany({
        where: { rowId: { in: rowIds }, proveedorId: null },
        data: { proveedorTextoNormalizado },
      });
      actualizadas += resultado.count;
    }

    if (actualizadas !== planEnVivo.actualizaciones.length) {
      throw new Error(
        `Verificación falló: se esperaba completar ${planEnVivo.actualizaciones.length} filas, se actualizaron ${actualizadas}`
      );
    }
  }, { timeout: 120000, maxWait: 20000 });

  const archivoAplicado = await exportarDetalle(planEnVivo.actualizaciones, `${SCRATCHPAD_DIR}/backfill-aplicado.json`);
  console.log(`\n=== Verificación post-backfill ===`);
  console.log(`Filas completadas: ${actualizadas}`);
  console.log(`Detalle exportado a ${archivoAplicado}`);
  console.log("\nBackfill completado y verificado.\n");
}

const esEntrypointCli = process.argv[1] === fileURLToPath(import.meta.url);

if (esEntrypointCli) {
  main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => (prisma as unknown as { $disconnect: () => Promise<void> }).$disconnect());
}
