/**
 * reset-transaccional.ts
 *
 * Borra datos transaccionales para permitir una re-importación limpia.
 *
 * Uso:
 *   npx tsx scripts/reset-transaccional.ts                  → todo (compras + detalle + ventas)
 *   npx tsx scripts/reset-transaccional.ts --only=compras   → solo compras + detalle_compras
 *   npx tsx scripts/reset-transaccional.ts --only=ventas    → solo ventas
 *   Agregar --force para omitir la advertencia de overrides manuales.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { prisma } from "../lib/prisma";

type Scope = "todo" | "compras" | "ventas";

function parseScope(): Scope {
  const arg = process.argv.find((a) => a.startsWith("--only="));
  if (!arg) return "todo";
  const val = arg.split("=")[1];
  if (val === "compras" || val === "ventas") return val;
  console.error(`Valor inválido para --only: "${val}". Usar "compras" o "ventas".`);
  process.exit(1);
}

async function main() {
  const force = process.argv.includes("--force");
  const scope = parseScope();

  const includeCompras = scope === "todo" || scope === "compras";
  const includeVentas  = scope === "todo" || scope === "ventas";

  // 1. Contar overrides manuales según scope
  const comprasConOverride = includeCompras
    ? await prisma.compra.count({
        where: {
          OR: [
            { importeManual: { not: null } },
            { fechaManual: { not: null } },
            { conceptoCodigoManual: { not: null } },
          ],
        },
      })
    : 0;

  const ventasConOverride = includeVentas
    ? await prisma.venta.count({ where: { importeManual: { not: null } } })
    : 0;

  const totalCompras = includeCompras ? await prisma.compra.count() : null;
  const totalVentas  = includeVentas  ? await prisma.venta.count()  : null;
  const totalDetalle = includeCompras ? await prisma.detalleCompra.count() : null;

  console.log(`\n=== Estado actual (scope: ${scope}) ===`);
  if (totalCompras != null) console.log(`Compras:         ${totalCompras}`);
  if (totalDetalle != null) console.log(`Detalle compras: ${totalDetalle}`);
  if (totalVentas  != null) console.log(`Ventas:          ${totalVentas}`);
  if (includeCompras) console.log(`Overrides en compras: ${comprasConOverride}`);
  if (includeVentas)  console.log(`Overrides en ventas:  ${ventasConOverride}`);

  if ((comprasConOverride > 0 || ventasConOverride > 0) && !force) {
    console.log(
      "\n⚠  Hay overrides manuales. Exportar antes de borrar.\n" +
      "   Re-ejecutar con --force para borrar igual.\n"
    );

    const fs = await import("fs");
    const backup: Record<string, unknown> = {};

    if (includeCompras && comprasConOverride > 0) {
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
          detalle: true, importeManual: true, fechaManual: true,
          conceptoCodigoManual: true,
        },
      });
    }

    if (includeVentas && ventasConOverride > 0) {
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

  // 2. Borrar en orden (FK: detalle_compras → compras)
  console.log("\nBorrando...");
  let dc = 0, c = 0, v = 0;

  if (includeCompras) {
    ({ count: dc } = await prisma.detalleCompra.deleteMany());
    ({ count: c }  = await prisma.compra.deleteMany());
  }
  if (includeVentas) {
    ({ count: v } = await prisma.venta.deleteMany());
  }

  if (includeCompras) console.log(`Borradas ${dc} detalle_compras, ${c} compras.`);
  if (includeVentas)  console.log(`Borradas ${v} ventas.`);
  console.log("\nListo. Re-importar los archivos del ERP desde la UI.\n");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => (prisma as unknown as { $disconnect: () => Promise<void> }).$disconnect());
