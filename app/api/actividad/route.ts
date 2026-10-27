import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuthUser } from "@/lib/auth/require-auth";

export const dynamic = "force-dynamic";

// GET — actividad para la campanita: la mía (por defecto) o la de todos, lo más nuevo primero.
export async function GET(request: NextRequest) {
  const { user, response } = await requireAuthUser();
  if (response) return response;
  const sp = new URL(request.url).searchParams;
  const todos = sp.get("todos") === "1";
  const limite = Math.min(Math.max(Number(sp.get("limite")) || 20, 1), 200);
  const yo = user.email ?? user.id;
  const filas = await prisma.actividad.findMany({
    where: todos ? {} : { usuario: yo },
    orderBy: { creadoEn: "desc" },
    take: limite + 1,
  });
  return NextResponse.json({
    yo,
    hayMas: filas.length > limite,
    data: filas.slice(0, limite).map((a) => {
      const d = (a.datos ?? null) as { payload?: unknown; restauradaEn?: string } | null;
      return {
        id: a.id, tipo: a.tipo, accion: a.accion, descripcion: a.descripcion, refId: a.refId,
        usuario: a.usuario, creadoEn: a.creadoEn.toISOString(),
        restaurable: a.tipo === "factura" && a.accion === "eliminada" && !!d?.payload && !d.restauradaEn,
      };
    }),
  });
}
