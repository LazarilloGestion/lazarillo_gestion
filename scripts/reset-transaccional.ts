/**
 * reset-transaccional.ts
 *
 * Borra compras, detalle_compras y ventas para permitir una re-importación limpia
 * después de corregir el cálculo de rowId.
 *
 * Uso: npx tsx scripts/reset-transaccional.ts
 *      npx tsx scripts/reset-transaccional.ts --force
 *
 * Sin --force muestra un resumen y pide confirmación si hay overrides manuales.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { prisma } from "../lib/prisma";

async function main() {
  const force = process.argv.includes("--force");

  // 1. Contar overrides manuales en compras
  const comprasConOverride = await prisma.compra.count({
    where: {
      OR: [
        { importeManual: { not: null } },
        { fechaManual: { not: null } },
        { conceptoCodigoManual: { not: null } },
      ],
    },
  });

  const ventasConOverride = await prisma.venta.count({
    where: { importeManual: { not: null } },
  });

  const totalCompras = await prisma.compra.count();
  const totalVentas = await prisma.venta.count();
  const totalDetalle = await prisma.detalleCompra.count();

  console.log("\n=== Estado actual ===");
  console.log(`Compras:         ${totalCompras}`);
  console.log(`Detalle compras: ${totalDetalle}`);
  console.log(`Ventas:          ${totalVentas}`);
  console.log(`Overrides en compras: ${comprasConOverride}`);
  console.log(`Overrides en ventas:  ${ventasConOverride}`);

  if ((comprasConOverride > 0 || ventasConOverride > 0) && !force) {
    console.log(
      "\n⚠  Hay overrides manuales. Exportar antes de borrar.\n" +
      "   Re-ejecutar con --force para borrar igual.\n"
    );

    // Exportar los overrides a un JSON por si acaso
    const overridesCompras = await prisma.compra.findMany({
      where: {
        OR: [
          { importeManual: { not: null } },
          { fechaManual: { not: null } },
          { conceptoCodigoManual: { not: null } },
        ],
      },
      select: {
        rowId: true, codCga: true, fecha: true, codigo: true, concepto: true,
        detalle: true, importeManual: true, fechaManual: true,
        conceptoCodigoManual: true,
      },
    });

    const overridesVentas = await prisma.venta.findMany({
      where: { importeManual: { not: null } },
      select: {
        rowId: true, turno: true, comprobant: true, codCobro: true,
        cobro: true, fecha: true, importeManual: true,
      },
    });

    const fs = await import("fs");
    const backup = { compras: overridesCompras, ventas: overridesVentas };
    fs.writeFileSync(
      "overrides-backup.json",
      JSON.stringify(backup, null, 2)
    );
    console.log("   Backup guardado en overrides-backup.json\n");
    process.exit(1);
  }

  // 2. Borrar en orden (FK: detalle_compras → compras)
  console.log("\nBorrando...");
  const { count: dc } = await prisma.detalleCompra.deleteMany();
  const { count: c }  = await prisma.compra.deleteMany();
  const { count: v }  = await prisma.venta.deleteMany();

  console.log(`Borradas ${dc} detalle_compras, ${c} compras, ${v} ventas.`);
  console.log("\nListo. Re-importar los archivos del ERP desde la UI.\n");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => (prisma as unknown as { $disconnect: () => Promise<void> }).$disconnect());
