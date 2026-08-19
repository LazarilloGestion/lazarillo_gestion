/**
 * migrate-rowid-compras.ts
 *
 * Recalcula el rowId de cada compra existente con la identidad partida
 * (con/sin comprobante, ver lib/etl/normalizers/compra-identity.ts) y actualiza
 * compras.rowId + detalle_compras.compraId en la misma transacción por fila.
 *
 * Por defecto corre en modo dry-run (solo reporta el plan, no escribe nada).
 * Requiere --apply para ejecutar los UPDATE contra la base real.
 *
 * Uso:
 *   npx tsx scripts/migrate-rowid-compras.ts             # dry-run
 *   npx tsx scripts/migrate-rowid-compras.ts --apply      # aplica de verdad
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { fileURLToPath } from "url";
import { prisma } from "../lib/prisma";
import { computeCompraRowId, compraIdentityFromDbRecord } from "../lib/etl/normalizers/compra-identity";

interface CompraForMigration {
  rowId: string;
  codCga: string | null;
  fecha: Date | null;
  codigo: string | null;
  concepto: string | null;
  comprobante: string | null;
  detalle: string | null;
  observac: string | null;
  importe: { toString(): string } | null;
}

export interface RowIdMigrationPlan {
  rowIdViejo: string;
  rowIdNuevo: string;
  colision: boolean; // true si rowIdNuevo coincide con el de otra compra en el mismo plan
}

// Función pura, testable sin base de datos real — separa "qué hay que cambiar"
// de "cómo se aplica el cambio".
export function planRowIdMigration(compras: CompraForMigration[]): RowIdMigrationPlan[] {
  const nuevos = compras.map((c) => ({
    rowIdViejo: c.rowId,
    rowIdNuevo: computeCompraRowId(compraIdentityFromDbRecord(c)),
  }));

  const conteoNuevos = new Map<string, number>();
  for (const n of nuevos) {
    conteoNuevos.set(n.rowIdNuevo, (conteoNuevos.get(n.rowIdNuevo) ?? 0) + 1);
  }

  return nuevos
    .filter((n) => n.rowIdNuevo !== n.rowIdViejo)
    .map((n) => ({ ...n, colision: (conteoNuevos.get(n.rowIdNuevo) ?? 0) > 1 }));
}

async function main() {
  const apply = process.argv.includes("--apply");

  const totalAntes = await prisma.compra.count();
  const totalDetalleAntes = await prisma.detalleCompra.count();
  const sumaImporteAntes = await prisma.compra.aggregate({ _sum: { importe: true } });

  console.log(`\n=== Estado antes de migrar ===`);
  console.log(`Compras: ${totalAntes} · Detalle compras: ${totalDetalleAntes} · Suma importe: ${sumaImporteAntes._sum.importe}`);

  const compras = await prisma.compra.findMany({
    select: {
      rowId: true, codCga: true, fecha: true, codigo: true, concepto: true,
      comprobante: true, detalle: true, observac: true, importe: true,
    },
  });

  const plan = planRowIdMigration(compras);
  const colisiones = plan.filter((p) => p.colision);

  console.log(`\n=== Plan de migración ===`);
  console.log(`Compras a actualizar: ${plan.length} de ${compras.length}`);
  console.log(`Colisiones detectadas (requieren revisión manual antes de aplicar): ${colisiones.length}`);

  if (colisiones.length > 0) {
    console.log("\n⚠ Hay colisiones — no se aplica nada. Revisar estas filas a mano:");
    console.log(JSON.stringify(colisiones.slice(0, 20), null, 2));
    process.exit(1);
  }

  if (!apply) {
    console.log("\nDry-run — no se escribió nada. Re-ejecutar con --apply para aplicar.\n");
    const fs = await import("fs");
    fs.writeFileSync("rowid-migration-plan.json", JSON.stringify(plan, null, 2));
    console.log("Plan completo guardado en rowid-migration-plan.json\n");
    return;
  }

  console.log("\nAplicando...");
  let actualizadas = 0;
  for (const { rowIdViejo, rowIdNuevo } of plan) {
    await prisma.$transaction([
      prisma.detalleCompra.updateMany({ where: { compraId: rowIdViejo }, data: { compraId: rowIdNuevo } }),
      prisma.compra.update({ where: { rowId: rowIdViejo }, data: { rowId: rowIdNuevo } }),
    ]);
    actualizadas++;
  }

  const totalDespues = await prisma.compra.count();
  const totalDetalleDespues = await prisma.detalleCompra.count();
  const sumaImporteDespues = await prisma.compra.aggregate({ _sum: { importe: true } });
  const huerfanas = await prisma.detalleCompra.count({ where: { compraId: { not: null }, compra: null } });

  console.log(`\n=== Verificación post-migración ===`);
  console.log(`Compras actualizadas: ${actualizadas}`);
  console.log(`Compras: ${totalDespues} (antes ${totalAntes}) · Detalle: ${totalDetalleDespues} (antes ${totalDetalleAntes})`);
  console.log(`Suma importe: ${sumaImporteDespues._sum.importe} (antes ${sumaImporteAntes._sum.importe})`);
  console.log(`Detalle_compras huérfanas: ${huerfanas}`);

  if (totalDespues !== totalAntes || totalDetalleDespues !== totalDetalleAntes || huerfanas > 0) {
    console.error("\n⚠ VERIFICACIÓN FALLÓ — revisar antes de continuar con cualquier otro paso.\n");
    process.exit(1);
  }

  console.log("\nMigración completada y verificada.\n");
}

// Ejecuta main() solo cuando el script corre como entrypoint de CLI (tsx),
// nunca cuando se importa este módulo (p.ej. desde el test de
// planRowIdMigration) — sin este guard, importar el módulo dispararía
// consultas contra la base real configurada en .env.local.
const esEntrypointCli = process.argv[1] === fileURLToPath(import.meta.url);

if (esEntrypointCli) {
  main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => (prisma as unknown as { $disconnect: () => Promise<void> }).$disconnect());
}
