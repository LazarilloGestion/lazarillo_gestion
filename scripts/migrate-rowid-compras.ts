/**
 * migrate-rowid-compras.ts
 *
 * Recalcula el rowId de cada compra existente con la identidad partida
 * (con/sin comprobante, ver lib/etl/normalizers/compra-identity.ts) y actualiza
 * compras.rowId con un único UPDATE por fila. No hace falta tocar
 * detalle_compras a mano: la FK real detalle_compras_compraId_fkey (ver
 * prisma/migrations/20260504151051_init/migration.sql) es ON UPDATE CASCADE,
 * así que Postgres propaga el nuevo rowId a detalle_compras.compraId de forma
 * atómica como parte del mismo UPDATE.
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

  // Se persiste el plan siempre (dry-run o --apply, con o sin colisiones) y
  // antes de tocar la base — así queda un registro en disco de qué mapping
  // se pensaba aplicar aunque --apply falle a mitad de camino.
  const fs = await import("fs");
  fs.writeFileSync("rowid-migration-plan.json", JSON.stringify(plan, null, 2));

  console.log(`\n=== Plan de migración ===`);
  console.log(`Compras a actualizar: ${plan.length} de ${compras.length}`);
  console.log(`Colisiones detectadas (requieren revisión manual antes de aplicar): ${colisiones.length}`);
  console.log("Plan completo guardado en rowid-migration-plan.json");

  if (colisiones.length > 0) {
    // Recalculamos el rowIdNuevo para TODAS las compras (no solo las que
    // planRowIdMigration incluyó en `plan`, que filtra las que no cambian)
    // para no perder del reporte una compra sin cambios cuyo rowId actual
    // colisiona con el rowIdNuevo de otra — ese caso también hay que revisar.
    const nuevoRowIdPorCompra = new Map(
      compras.map((c) => [c.rowId, computeCompraRowId(compraIdentityFromDbRecord(c))])
    );
    const conteoNuevos = new Map<string, number>();
    for (const nuevo of nuevoRowIdPorCompra.values()) {
      conteoNuevos.set(nuevo, (conteoNuevos.get(nuevo) ?? 0) + 1);
    }
    const gruposColision = new Map<string, CompraForMigration[]>();
    for (const c of compras) {
      const nuevo = nuevoRowIdPorCompra.get(c.rowId)!;
      if ((conteoNuevos.get(nuevo) ?? 0) > 1) {
        const grupo = gruposColision.get(nuevo) ?? [];
        grupo.push(c);
        gruposColision.set(nuevo, grupo);
      }
    }
    const colisionesCompletas = Array.from(gruposColision.entries()).map(([rowIdNuevo, grupo]) => ({
      rowIdNuevo,
      compras: grupo.map((c) => ({
        rowId: c.rowId,
        codCga: c.codCga,
        fecha: c.fecha,
        codigo: c.codigo,
        concepto: c.concepto,
        comprobante: c.comprobante,
        detalle: c.detalle,
        importe: c.importe != null ? c.importe.toString() : null,
      })),
    }));
    fs.writeFileSync("rowid-collisions.json", JSON.stringify(colisionesCompletas, null, 2));
    console.log(`\n⚠ ${colisionesCompletas.length} grupos de colisión — no se aplica nada. Ver rowid-collisions.json para investigar.`);
    process.exit(1);
  }

  if (!apply) {
    console.log("\nDry-run — no se escribió nada más. Re-ejecutar con --apply para aplicar.\n");
    return;
  }

  console.log("\nAplicando...");
  // Todo el plan en una sola $transaction — cada UPDATE individual ya es
  // atómico por sí solo (y la FK ON UPDATE CASCADE de
  // detalle_compras_compraId_fkey propaga el nuevo rowId a
  // detalle_compras.compraId a nivel de base), pero sin envolver el loop
  // completo, un fallo a mitad de camino (hiccup de DB, colisión transitoria)
  // deja la tabla compras a medio migrar sin forma de volver atrás (hallazgo
  // de code-review, 24-ago-2026). Mismo criterio de timeout generoso que
  // cleanup-duplicados-compras.ts para un script de un solo uso.
  const actualizadas = await prisma.$transaction(
    async (tx) => {
      let count = 0;
      for (const { rowIdViejo, rowIdNuevo } of plan) {
        await tx.compra.update({ where: { rowId: rowIdViejo }, data: { rowId: rowIdNuevo } });
        count++;
      }
      return count;
    },
    { timeout: 120000, maxWait: 20000 }
  );

  const totalDespues = await prisma.compra.count();
  const totalDetalleDespues = await prisma.detalleCompra.count();
  const sumaImporteDespues = await prisma.compra.aggregate({ _sum: { importe: true } });
  // La FK ON UPDATE CASCADE hace que esto sea estructuralmente imposible
  // (no puede quedar un detalle_compras.compraId apuntando a un rowId que ya
  // no existe) — se deja como re-chequeo defensivo, no porque se espere > 0.
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
