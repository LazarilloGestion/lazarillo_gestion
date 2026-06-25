/**
 * reset-transaccional.ts
 *
 * Borra todos los datos (transaccionales + maestros) para una re-importación limpia.
 * Agregar --force para omitir la advertencia de overrides manuales.
 *
 * Uso:
 *   npx tsx scripts/reset-transaccional.ts
 *   npx tsx scripts/reset-transaccional.ts --force
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { prisma } from "../lib/prisma";

async function main() {
  const force = process.argv.includes("--force");

  const [comprasConOverride, ventasConOverride] = await Promise.all([
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

  if ((comprasConOverride > 0 || ventasConOverride > 0) && !force) {
    console.log(
      "\n⚠  Hay overrides manuales. Exportar antes de borrar.\n" +
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

    fs.writeFileSync("overrides-backup.json", JSON.stringify(backup, null, 2));
    console.log("   Backup guardado en overrides-backup.json\n");
    process.exit(1);
  }

  console.log("\nBorrando...");

  // Orden FK: hijos primero
  const { count: dc } = await prisma.detalleCompra.deleteMany();
  const { count: c }  = await prisma.compra.deleteMany();
  const { count: v }  = await prisma.venta.deleteMany();
  const { count: art } = await prisma.articulo.deleteMany();
  const { count: sub } = await prisma.subrubroArticulo.deleteMany();
  const { count: prov } = await prisma.proveedor.deleteMany();
  const { count: conc } = await prisma.conceptoCaja.deleteMany();
  const { count: rcga } = await prisma.rubroConceptoCaja.deleteMany();
  const { count: rua }  = await prisma.rubroArticulo.deleteMany();

  console.log(`Borradas ${dc} detalle_compras, ${c} compras, ${v} ventas.`);
  console.log(`Borradas ${art} artículos, ${sub} subrubros, ${prov} proveedores.`);
  console.log(`Borradas ${conc} conceptos, ${rcga} rubros-concepto, ${rua} rubros-artículo.`);
  console.log("\nListo. Re-importar los archivos del ERP desde la UI.\n");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => (prisma as unknown as { $disconnect: () => Promise<void> }).$disconnect());
