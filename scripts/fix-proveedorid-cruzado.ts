/**
 * fix-proveedorid-cruzado.ts
 *
 * Corrige compras cuyo proveedorId quedó linkeado a un proveedor incorrecto por
 * colisión de código (ver docs/superpowers/specs/2026-09-19-cruce-proveedorid-compras-design.md).
 * El ETL ya corta la causa para futuros imports (lib/etl/normalizers/compras.ts) —
 * este script corrige las filas que ya quedaron mal linkeadas en producción.
 *
 * Por defecto corre en modo dry-run (solo reporta el plan, no escribe nada).
 * Requiere --apply para ejecutar contra la base real.
 *
 * Uso:
 *   npx tsx scripts/fix-proveedorid-cruzado.ts             # dry-run
 *   npx tsx scripts/fix-proveedorid-cruzado.ts --apply      # aplica de verdad
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { fileURLToPath } from "url";
import * as path from "path";
import { prisma } from "../lib/prisma";
import { proveedorTextoCoincide } from "../lib/etl/normalizers/proveedor-match";

// Relativo al repo (gitignored, ver .gitignore) — mismo criterio que
// cleanup-duplicados-compras.ts: este módulo corre como ESM bajo tsx (usa
// import.meta.url más abajo), no hay __dirname disponible.
const SCRATCHPAD_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "tmp", "fix-proveedorid-cruzado");

export interface CompraParaFix {
  rowId: string;
  proveedor: string | null;
  proveedorNombre: string | null;
  proveedorRazon: string | null;
}

export interface PlanFixProveedor {
  rowIdANulificar: string[];
}

// Función pura, testable sin base de datos real — separa "qué hay que
// corregir" de "cómo se aplica la corrección" (mismo criterio que
// planCleanupDuplicados en cleanup-duplicados-compras.ts). Reusa
// proveedorTextoCoincide (lib/etl/normalizers/proveedor-match.ts) en vez de
// reimplementar el criterio de matching — es la misma regla que ya corta la
// causa raíz para los imports nuevos.
export function planFixProveedorCruzado(compras: CompraParaFix[]): PlanFixProveedor {
  const rowIdANulificar = compras
    .filter((c) => !proveedorTextoCoincide(c.proveedor, { nombre: c.proveedorNombre, razon: c.proveedorRazon }))
    .map((c) => c.rowId);
  return { rowIdANulificar };
}

interface CompraDbRow {
  rowId: string;
  proveedor: string | null;
  importe: { toString(): string } | null;
  fecha: Date | null;
  proveedorRef: { nombre: string | null; razon: string | null } | null;
}

const SELECT_COMPRA = {
  rowId: true,
  proveedor: true,
  importe: true,
  fecha: true,
  proveedorRef: { select: { nombre: true, razon: true } },
} as const;

function aCompraParaFix(c: CompraDbRow): CompraParaFix {
  return {
    rowId: c.rowId,
    proveedor: c.proveedor,
    proveedorNombre: c.proveedorRef?.nombre ?? null,
    proveedorRazon: c.proveedorRef?.razon ?? null,
  };
}

async function exportarDetalle(rowIds: string[], porRowId: Map<string, CompraDbRow>, archivo: string) {
  const detalle = rowIds.map((rowId) => {
    const c = porRowId.get(rowId)!;
    return {
      rowId: c.rowId,
      proveedorTextoCrudo: c.proveedor,
      proveedorNombreActual: c.proveedorRef?.nombre ?? null,
      importe: c.importe != null ? c.importe.toString() : null,
      fecha: c.fecha,
    };
  });
  const fs = await import("fs");
  fs.mkdirSync(path.dirname(archivo), { recursive: true });
  fs.writeFileSync(archivo, JSON.stringify(detalle, null, 2));
  return archivo;
}

async function main() {
  const apply = process.argv.includes("--apply");

  const compras: CompraDbRow[] = await prisma.compra.findMany({
    where: { proveedorId: { not: null } },
    select: SELECT_COMPRA,
  });
  const plan = planFixProveedorCruzado(compras.map(aCompraParaFix));
  const porRowId = new Map(compras.map((c) => [c.rowId, c]));

  console.log(`\n=== Plan de corrección de proveedorId cruzado (${apply ? "aplicando" : "dry-run"}) ===`);
  console.log(`Compras con proveedorId asignado: ${compras.length}`);
  console.log(`Filas a poner en null (cruzadas): ${plan.rowIdANulificar.length}`);

  const archivoDryRun = await exportarDetalle(plan.rowIdANulificar, porRowId, `${SCRATCHPAD_DIR}/fix-proveedorid-dry-run.json`);
  console.log(`Detalle exportado a ${archivoDryRun}`);

  if (!apply) {
    console.log("\nDry-run — no se escribió nada en la base. Re-ejecutar con --apply para aplicar.\n");
    return;
  }

  console.log("\nAplicando...");

  // Recálculo en vivo — nunca se reusa el plan de arriba, por si algo cambió
  // la base entre el arranque del script y este punto (mismo criterio que
  // cleanup-duplicados-compras.ts).
  const comprasEnVivo: CompraDbRow[] = await prisma.compra.findMany({
    where: { proveedorId: { not: null } },
    select: SELECT_COMPRA,
  });
  const planEnVivo = planFixProveedorCruzado(comprasEnVivo.map(aCompraParaFix));
  const porRowIdEnVivo = new Map(comprasEnVivo.map((c) => [c.rowId, c]));

  if (planEnVivo.rowIdANulificar.length !== plan.rowIdANulificar.length) {
    throw new Error(
      `Plan cambió entre el resumen mostrado y la ejecución: ` +
        `se esperaba corregir ${plan.rowIdANulificar.length} filas, ` +
        `pero el recálculo en vivo encontró ${planEnVivo.rowIdANulificar.length}`
    );
  }

  if (planEnVivo.rowIdANulificar.length === 0) {
    console.log("\nNo hay nada para corregir.\n");
    return;
  }

  const { cantidadActualizada } = await prisma.$transaction(
    async (tx) => {
      const candidatasAhora = await tx.compra.count({
        where: { rowId: { in: planEnVivo.rowIdANulificar }, proveedorId: { not: null } },
      });
      if (candidatasAhora !== planEnVivo.rowIdANulificar.length) {
        throw new Error(
          `Verificación falló: ${planEnVivo.rowIdANulificar.length} filas candidatas esperadas, ` +
            `${candidatasAhora} encontradas justo antes de aplicar — alguna cambió entremedio.`
        );
      }

      const resultado = await tx.compra.updateMany({
        where: { rowId: { in: planEnVivo.rowIdANulificar } },
        data: { proveedorId: null },
      });
      if (resultado.count !== planEnVivo.rowIdANulificar.length) {
        throw new Error(
          `Verificación falló: se esperaba corregir ${planEnVivo.rowIdANulificar.length} filas, se actualizaron ${resultado.count}`
        );
      }

      return { cantidadActualizada: resultado.count };
    },
    { timeout: 30000, maxWait: 20000 }
  );

  const archivoAplicado = await exportarDetalle(
    planEnVivo.rowIdANulificar,
    porRowIdEnVivo,
    `${SCRATCHPAD_DIR}/fix-proveedorid-aplicado.json`
  );

  console.log(`\n=== Verificación post-corrección ===`);
  console.log(`Filas corregidas (proveedorId → null): ${cantidadActualizada}`);
  console.log(`Detalle de lo corregido exportado a ${archivoAplicado}`);
  console.log("\nCorrección completada y verificada.\n");
}

const esEntrypointCli = process.argv[1] === fileURLToPath(import.meta.url);

if (esEntrypointCli) {
  main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => (prisma as unknown as { $disconnect: () => Promise<void> }).$disconnect());
}
