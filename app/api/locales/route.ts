import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth/require-auth";

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;

  const locales = await prisma.local.findMany({
    include: { puntosDeVenta: { orderBy: { nombre: "asc" } } },
    orderBy: { nombre: "asc" },
  });
  return NextResponse.json(locales);
}
