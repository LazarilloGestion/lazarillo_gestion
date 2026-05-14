import "./load-env";

if (process.argv[2] !== "--confirm") {
  console.error("Esta operación elimina TODOS los datos de ventas de la DB.");
  console.error("Para ejecutar: npx tsx scripts/clean-ventas.ts --confirm");
  process.exit(1);
}

async function main() {
  const { prisma } = await import("../lib/prisma");
  const count = await prisma.venta.count();
  console.log("Ventas actuales:", count);
  await prisma.$executeRaw`DELETE FROM ventas`;
  console.log("Ventas eliminadas.");
  await prisma.$disconnect();
}
main().catch(console.error);
