import * as path from "path";
import { config } from "dotenv";
config({ path: path.join(process.cwd(), ".env") });
config({ path: path.join(process.cwd(), ".env.local"), override: true });

async function main() {
  const { prisma } = await import("../lib/prisma");
  const count = await prisma.venta.count();
  console.log("Ventas actuales:", count);
  await prisma.$executeRaw`DELETE FROM ventas`;
  console.log("Ventas eliminadas.");
  await prisma.$disconnect();
}
main().catch(console.error);
