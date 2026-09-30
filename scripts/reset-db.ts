/**
 * reset-db.ts
 *
 * Borra todos los datos (transaccionales + maestros + apertura de gastos)
 * para una re-importación limpia. Agregar --force para omitir la advertencia
 * de overrides manuales / distribuciones de apertura / reglas activas.
 *
 * Uso:
 *   npx tsx scripts/reset-db.ts
 *   npx tsx scripts/reset-db.ts --force
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { fileURLToPath } from "url";
import { prisma } from "../lib/prisma";

export interface ResetCounts {
  overridesCompras: number;
  overridesVentas: number;
  distribuciones: number;
  reglas: number;
}

export interface ResetPlan {
  debeBloquear: boolean;
  motivos: string[];
}

// Función pura, testable sin base de datos real — separa "¿hay que bloquear
// y por qué?" de "cómo se exportan los backups y se pide --force". Un reset
// completo borra compras/ventas/maestros Y apertura de gastos: sin este
// chequeo, un reset silenciosamente destruía dinero ya distribuido
// (distribuciones_apertura) y dejaba reglas activas sobreviviendo para
// reaplicarse solas en el próximo import (hallazgo de code-review).
export function planReset(counts: ResetCounts): ResetPlan {
  const motivos: string[] = [];
  if (counts.overridesCompras > 0 || counts.overridesVentas > 0) {
    motivos.push("overrides manuales en compras/ventas");
  }
  if (counts.distribuciones > 0) {
    motivos.push("distribuciones de apertura (dinero ya distribuido)");
  }
  if (counts.reglas > 0) {
    motivos.push("reglas de apertura activas");
  }
  return { debeBloquear: motivos.length > 0, motivos };
}

async function main() {
  const force = process.argv.includes("--force");

  const [comprasConOverride, ventasConOverride, distribuciones, reglas] = await Promise.all([
    prisma.compra.count({
      where: {
        OR: [
          { importeManual: { not: null } },
          { fechaManual: { not: null } },
          { conceptoCodigoManual: { not: null } },
        ],
      },
    }),
    prisma.venta.count({ where: { importeManual: { not: null } } }),
    prisma.distribucionApertura.count(),
    prisma.reglaApertura.count(),
  ]);

  const [totalCompras, totalDetalle, totalVentas, totalProveedores, totalConceptos, totalArticulos] =
    await Promise.all([
      prisma.compra.count(),
      prisma.detalleCompra.count(),
      prisma.venta.count(),
      prisma.proveedor.count(),
      prisma.conceptoCaja.count(),
      prisma.articulo.count(),
    ]);

  console.log(`\n=== Estado actual ===`);
  console.log(`Compras:         ${totalCompras}`);
  console.log(`Detalle compras: ${totalDetalle}`);
  console.log(`Ventas:          ${totalVentas}`);
  console.log(`Proveedores:     ${totalProveedores}`);
  console.log(`Conceptos:       ${totalConceptos}`);
  console.log(`Artículos:       ${totalArticulos}`);
  console.log(`Overrides en compras: ${comprasConOverride}`);
  console.log(`Overrides en ventas:  ${ventasConOverride}`);
  console.log(`Distribuciones de apertura: ${distribuciones}`);
  console.log(`Reglas de apertura: ${reglas}`);

  const plan = planReset({ overridesCompras: comprasConOverride, overridesVentas: ventasConOverride, distribuciones, reglas });

  if (plan.debeBloquear && !force) {
    console.log(
      `\n⚠  Hay datos que un reset borraría sin dejar rastro: ${plan.motivos.join(", ")}.\n` +
      "   Exportar antes de borrar.\n" +
      "   Re-ejecutar con --force para borrar igual.\n"
    );

    const fs = await import("fs");
    const backup: Record<string, unknown> = {};

    if (comprasConOverride > 0) {
      backup.compras = await prisma.compra.findMany({
        where: {
          OR: [
            { importeManual: { not: null } },
            { fechaManual: { not: null } },
            { conceptoCodigoManual: { not: null } },
          ],
        },
        select: {
          rowId: true, codCga: true, fecha: true, codigo: true, concepto: true,
          detalle: true, importeManual: true, fechaManual: true, conceptoCodigoManual: true,
        },
      });
    }

    if (ventasConOverride > 0) {
      backup.ventas = await prisma.venta.findMany({
        where: { importeManual: { not: null } },
        select: {
          rowId: true, turno: true, comprobant: true, codCobro: true,
          cobro: true, fecha: true, importeManual: true,
        },
      });
    }

    if (distribuciones > 0) {
      backup.distribuciones = await prisma.distribucionApertura.findMany({
        select: {
          id: true, compraRowId: true, reglaId: true, destinoId: true,
          importeOriginal: true, porcentaje: true, importeCalculado: true,
        },
      });
    }

    if (reglas > 0) {
      backup.reglas = await prisma.reglaApertura.findMany({
        include: { destinos: true },
      });
    }

    fs.writeFileSync("reset-db-backup.json", JSON.stringify(backup, null, 2));
    console.log("   Backup guardado en reset-db-backup.json\n");
    process.exit(1);
  }

  console.log("\nBorrando...");

  // Todo en una sola transacción, con conteo antes/después — un fallo a
  // mitad de camino no debe dejar la base en un estado parcialmente borrado
  // sin forma de saberlo (mismo criterio que cleanup-duplicados-compras.ts /
  // migrate-rowid-compras.ts / reconciliar-duplicados-erp.ts).
  const resultado = await prisma.$transaction(
    async (tx) => {
      // Orden FK: hijos primero. distribucionApertura.destinoId y .reglaId
      // son ambos onDelete: Restrict (ver prisma/schema.prisma) — hay que
      // borrar distribucionApertura ANTES de destinoRegla/reglaApertura, no
      // al revés, o Postgres rechaza el borrado por violación de FK. Sin
      // este orden completo el reset dejaba reglas activas sobreviviendo
      // (se reaplicaban solas en el próximo import) y dinero ya distribuido
      // borrado sin dejar rastro.
      const { count: da } = await tx.distribucionApertura.deleteMany();
      const { count: dr } = await tx.destinoRegla.deleteMany();
      const { count: dc } = await tx.detalleCompra.deleteMany();
      const { count: c } = await tx.compra.deleteMany();
      const { count: v } = await tx.venta.deleteMany();
      const { count: art } = await tx.articulo.deleteMany();
      const { count: sub } = await tx.subrubroArticulo.deleteMany();
      const { count: prov } = await tx.proveedor.deleteMany();
      const { count: conc } = await tx.conceptoCaja.deleteMany();
      const { count: rcga } = await tx.rubroConceptoCaja.deleteMany();
      const { count: rua } = await tx.rubroArticulo.deleteMany();
      const { count: ra } = await tx.reglaApertura.deleteMany();

      return { dr, da, dc, c, v, art, sub, prov, conc, rcga, rua, ra };
    },
    { timeout: 60000, maxWait: 20000 }
  );

  console.log(`Borradas ${resultado.dr} destinos de regla, ${resultado.da} distribuciones de apertura, ${resultado.ra} reglas de apertura.`);
  console.log(`Borradas ${resultado.dc} detalle_compras, ${resultado.c} compras, ${resultado.v} ventas.`);
  console.log(`Borradas ${resultado.art} artículos, ${resultado.sub} subrubros, ${resultado.prov} proveedores.`);
  console.log(`Borradas ${resultado.conc} conceptos, ${resultado.rcga} rubros-concepto, ${resultado.rua} rubros-artículo.`);
  console.log("\nListo. Re-importar los archivos del ERP desde la UI.\n");
}

// Ejecuta main() solo cuando el script corre como entrypoint de CLI (tsx),
// nunca cuando se importa este módulo (p.ej. desde el test de planReset) —
// sin este guard, importar el módulo dispararía consultas contra la base
// real configurada en .env.local (mismo criterio que los demás scripts de
// esta carpeta).
const esEntrypointCli = process.argv[1] === fileURLToPath(import.meta.url);

if (esEntrypointCli) {
  main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => (prisma as unknown as { $disconnect: () => Promise<void> }).$disconnect());
}
