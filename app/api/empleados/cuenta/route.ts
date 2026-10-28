import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth/require-auth";
import { conceptoAdelantoSql, movimientosEmpleadoSql, type MovimientoEmpleado } from "@/lib/empleados/query";

export const dynamic = "force-dynamic";

// GET ?pdvId&codigo — cuenta corriente del empleado por período (últimos 12 meses): adelantos,
// sueldo y las cargas hechas en Lazarillo (que se pueden anular).
export async function GET(request: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const sp = request.nextUrl.searchParams;
  const pdvId = Number(sp.get("pdvId"));
  const codigo = (sp.get("codigo") ?? "").trim();
  if (!Number.isInteger(pdvId) || pdvId <= 0 || !codigo || codigo.length > 20) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  try {
    const emp = (await prisma.$queryRaw<{ nombre: string }[]>`
      SELECT TRIM(nombre) AS nombre FROM empleados WHERE "puntoDeVentaId" = ${pdvId} AND codigo = ${codigo} LIMIT 1`)[0];
    if (!emp) return NextResponse.json({ error: "Ese empleado no está en la nómina del PDV" }, { status: 404 });
    const d = new Date();
    const desde = `${d.getFullYear() - 1}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
    const [movs, adelanto, cargas] = await Promise.all([
      prisma.$queryRaw<MovimientoEmpleado[]>(movimientosEmpleadoSql(pdvId, codigo, emp.nombre, desde)),
      prisma.$queryRaw<{ codigo: string }[]>(conceptoAdelantoSql),
      prisma.$queryRaw<{ id: number; tipo: string; periodo: string; fechaPago: string; total: number; creadoPor: string | null }[]>`
        SELECT id, tipo, to_char(periodo, 'YYYY-MM') AS periodo, to_char("fechaPago", 'YYYY-MM-DD') AS "fechaPago", total::float8 AS total, "creadoPor"
        FROM liquidaciones_empleado
        WHERE "puntoDeVentaId" = ${pdvId} AND "empleadoCodigo" = ${codigo} AND "anuladoEn" IS NULL AND periodo >= ${desde}::date
        ORDER BY "creadoEn" DESC`,
    ]);
    const codAdelanto = adelanto[0]?.codigo ?? null;
    const periodos = new Map<string, { periodo: string; adelantos: number; sueldo: number; movimientos: MovimientoEmpleado[] }>();
    for (const m of movs) {
      const p = periodos.get(m.periodo) ?? { periodo: m.periodo, adelantos: 0, sueldo: 0, movimientos: [] };
      if (m.cod === codAdelanto) p.adelantos += m.importe; else p.sueldo += m.importe;
      p.movimientos.push(m);
      periodos.set(m.periodo, p);
    }
    return NextResponse.json({
      codigoAdelanto: codAdelanto,
      periodos: [...periodos.values()].sort((a, b) => b.periodo.localeCompare(a.periodo)),
      cargas,
    });
  } catch (err) {
    console.error("[GET /api/empleados/cuenta]", err);
    return NextResponse.json({ error: "No se pudo leer la cuenta" }, { status: 500 });
  }
}
