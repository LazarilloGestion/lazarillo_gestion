import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuthUser } from "@/lib/auth/require-auth";
import { errorVigencia, superposicion } from "@/lib/empleados/concepto-fijo";
import { aplicarConceptosEmpleado, previsualizar, reglasActivas } from "@/lib/empleados/concepto-fijo-db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Concepto fijo por empleado (Diego 29/10/2026). Ver lib/empleados/concepto-fijo.ts.

// GET ?pdvId — reglas activas del PDV (con el nombre del concepto).
export async function GET(request: NextRequest) {
  const { response } = await requireAuthUser();
  if (response) return response;
  const pdvId = Number(request.nextUrl.searchParams.get("pdvId"));
  if (!Number.isInteger(pdvId) || pdvId <= 0) return NextResponse.json({ error: "Falta el PDV" }, { status: 400 });
  const reglas = await reglasActivas(prisma, pdvId);
  const conceptos = reglas.length
    ? await prisma.conceptoCaja.findMany({ where: { codigo: { in: [...new Set(reglas.map((r) => r.conceptoCodigo))] } }, select: { codigo: true, nombre: true } })
    : [];
  const nombre = new Map(conceptos.map((c) => [c.codigo, c.nombre]));
  return NextResponse.json({ reglas: reglas.map((r) => ({ ...r, conceptoNombre: nombre.get(r.conceptoCodigo) ?? r.conceptoCodigo })) });
}

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().transform((v) => (v ? `${v}T00:00:00.000Z` : null));
const reglaSchema = z.object({
  id: z.number().int().positive().optional(), // editar
  pdvId: z.number().int().positive(),
  entidadId: z.string().startsWith("texto:").max(200),
  nombre: z.string().trim().max(120).optional().nullable(),
  conceptoCodigo: z.string().trim().min(1).max(20),
  modo: z.enum(["historico", "entre_fechas", "desde_adelante", "desde_atras"]),
  fechaDesde: fecha,
  fechaHasta: fecha,
  extremosInclusivos: z.boolean().default(true),
  previsualizar: z.boolean().optional(),
});

// POST — previsualiza (previsualizar: true) o guarda la regla y la aplica.
export async function POST(request: NextRequest) {
  const { user, response } = await requireAuthUser();
  if (response) return response;
  const parsed = reglaSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos", detalle: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, { status: 400 });
  const b = parsed.data;
  const r = {
    id: b.id, entidadId: b.entidadId, origenPuntoDeVentaId: b.pdvId, conceptoCodigo: b.conceptoCodigo, modo: b.modo,
    fechaDesde: b.modo === "desde_atras" || b.modo === "historico" ? null : b.fechaDesde,
    fechaHasta: b.modo === "desde_adelante" || b.modo === "historico" ? null : b.fechaHasta,
    extremosInclusivos: b.modo === "historico" ? true : b.extremosInclusivos,
  };
  const err = errorVigencia(r);
  if (err) return NextResponse.json({ error: err }, { status: 400 });
  const concepto = await prisma.conceptoCaja.findUnique({ where: { codigo: b.conceptoCodigo }, select: { codigo: true } });
  if (!concepto) return NextResponse.json({ error: "Ese concepto no existe." }, { status: 400 });
  const choca = superposicion(r, await reglasActivas(prisma, b.pdvId));
  if (choca) return NextResponse.json({ error: "Ya hay otra regla de este empleado en ese período. Quitala o cambiá las fechas." }, { status: 409 });

  if (b.previsualizar) return NextResponse.json(await previsualizar(prisma, r));

  if (b.id) {
    await prisma.$executeRaw`
      UPDATE reglas_concepto_empleado SET "conceptoCodigo" = ${r.conceptoCodigo}, modo = ${r.modo}, "fechaDesde" = ${r.fechaDesde}::timestamp,
        "fechaHasta" = ${r.fechaHasta}::timestamp, "extremosInclusivos" = ${r.extremosInclusivos}, nombre = COALESCE(${b.nombre ?? null}, nombre)
      WHERE id = ${b.id} AND estado = 'activa' AND "origenPuntoDeVentaId" = ${b.pdvId}`;
  } else {
    await prisma.$executeRaw`
      INSERT INTO reglas_concepto_empleado ("entidadId", nombre, "origenPuntoDeVentaId", "conceptoCodigo", modo, "fechaDesde", "fechaHasta", "extremosInclusivos", "creadoPor")
      VALUES (${r.entidadId}, ${b.nombre ?? null}, ${b.pdvId}, ${r.conceptoCodigo}, ${r.modo}, ${r.fechaDesde}::timestamp, ${r.fechaHasta}::timestamp, ${r.extremosInclusivos}, ${user.email ?? user.id})`;
  }
  const res = await aplicarConceptosEmpleado(prisma, { pdvId: b.pdvId });
  return NextResponse.json({ ok: true, ...res });
}

// DELETE ?id&pdvId — quita la regla (queda inactiva) y vuelve los registros a su concepto original.
export async function DELETE(request: NextRequest) {
  const { response } = await requireAuthUser();
  if (response) return response;
  const sp = request.nextUrl.searchParams;
  const id = Number(sp.get("id")), pdvId = Number(sp.get("pdvId"));
  if (!Number.isInteger(id) || !Number.isInteger(pdvId)) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  await prisma.$executeRaw`UPDATE reglas_concepto_empleado SET estado = 'inactiva' WHERE id = ${id} AND "origenPuntoDeVentaId" = ${pdvId}`;
  const res = await aplicarConceptosEmpleado(prisma, { pdvId });
  return NextResponse.json({ ok: true, ...res });
}
