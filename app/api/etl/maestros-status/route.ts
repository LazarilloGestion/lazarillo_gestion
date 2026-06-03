import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/require-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;

  const [proveedores, conceptos, articulos] = await Promise.all([
    prisma.proveedor.count(),
    prisma.conceptoCaja.count(),
    prisma.articulo.count(),
  ]);

  return NextResponse.json({ loaded: proveedores > 0 && conceptos > 0 && articulos > 0 });
}
