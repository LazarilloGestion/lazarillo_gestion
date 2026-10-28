import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuthUser } from "@/lib/auth/require-auth";
import { registrarActividad } from "@/lib/facturas/guardar";
import { ORIGEN_LAZARILLO } from "@/lib/facturas/armar";

export const dynamic = "force-dynamic";

// DELETE — anula un sueldo o adelanto cargado en Lazarillo: borra sus filas de compras (y sus
// distribuciones de apertura, en cascada) y deja la cabecera marcada como anulada (historial).
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, response } = await requireAuthUser();
  if (response) return response;
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  const usuario = user.email ?? user.id;
  try {
    const ok = await prisma.$transaction(async (tx) => {
      const l = (await tx.$queryRaw<{ tipo: string; empleadoNombre: string; total: number; localId: number }[]>`
        SELECT tipo, "empleadoNombre", total::float8 AS total, "localId" FROM liquidaciones_empleado WHERE id = ${id} AND "anuladoEn" IS NULL FOR UPDATE`)[0];
      if (!l) return false;
      await tx.$executeRaw`DELETE FROM compras WHERE origen = ${ORIGEN_LAZARILLO} AND "rowId" LIKE ${`emp-${id}-%`}`;
      await tx.$executeRaw`UPDATE liquidaciones_empleado SET "anuladoEn" = now(), "anuladoPor" = ${usuario} WHERE id = ${id}`;
      await registrarActividad(tx, {
        tipo: "empleado", accion: "eliminada", refId: `emp-${id}`, localId: l.localId, usuario,
        descripcion: `${l.empleadoNombre}\n${l.tipo === "sueldo" ? "Sueldo" : "Adelanto"} anulado · $ ${l.total.toLocaleString("es-AR", { minimumFractionDigits: 2 })}`,
      });
      return true;
    });
    if (!ok) return NextResponse.json({ error: "No se encontró (o ya estaba anulado)" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[DELETE /api/empleados/[id]]", err);
    return NextResponse.json({ error: "No se pudo anular" }, { status: 500 });
  }
}
