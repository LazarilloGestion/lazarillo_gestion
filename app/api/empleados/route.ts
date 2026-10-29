import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireAuthUser } from "@/lib/auth/require-auth";
import { reaplicarReglasActivas } from "@/lib/apertura/motor";
import { aplicarConceptosEmpleado } from "@/lib/empleados/concepto-fijo-db";
import { registrarActividad } from "@/lib/facturas/guardar";
import { ORIGEN_LAZARILLO } from "@/lib/facturas/armar";
import { normalizarProveedorTexto } from "@/lib/text-normalize";
import { cargaEmpleadoSchema, filasEmpleado, validarSueldo } from "@/lib/empleados/carga";
import { conceptoAdelantoSql, movimientosEmpleadoSql, type MovimientoEmpleado } from "@/lib/empleados/query";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET ?pdvId — la nómina del PDV para la carga de empleados (activos y los dados de baja hace
// menos de 3 meses, que todavía cobran la liquidación final) y el concepto de los adelantos.
export async function GET(request: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const pdvId = Number(request.nextUrl.searchParams.get("pdvId"));
  if (!Number.isInteger(pdvId) || pdvId <= 0) return NextResponse.json({ error: "Elegí un PDV" }, { status: 400 });
  try {
    const [empleados, adelanto] = await Promise.all([
      prisma.$queryRaw<{ codigo: string; nombre: string; apellido: string | null; baja: string | null }[]>`
        SELECT codigo, TRIM(nombre) AS nombre, NULLIF(TRIM(apellido), '') AS apellido, to_char("fechaBaja", 'YYYY-MM-DD') AS baja
        FROM empleados
        WHERE "puntoDeVentaId" = ${pdvId} AND NULLIF(TRIM(nombre), '') IS NOT NULL
          AND ("fechaBaja" IS NULL OR "fechaBaja" >= CURRENT_DATE - 90)
        ORDER BY TRIM(nombre), apellido`,
      prisma.$queryRaw<{ codigo: string; nombre: string }[]>(conceptoAdelantoSql),
    ]);
    return NextResponse.json({ empleados, conceptoAdelanto: adelanto[0] ?? null });
  } catch (err) {
    console.error("[GET /api/empleados]", err);
    return NextResponse.json({ error: "No se pudo leer la nómina" }, { status: 500 });
  }
}

class Rechazo extends Error { constructor(msg: string, readonly status = 400) { super(msg); } }

// POST — un sueldo o un adelanto cargado a mano (ver lib/empleados/carga.ts).
export async function POST(request: NextRequest) {
  const { user, response } = await requireAuthUser();
  if (response) return response;
  const usuario = user.email ?? user.id;
  const parsed = cargaEmpleadoSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos", detalle: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, { status: 400 });
  const c = parsed.data;
  const periodo = `${c.periodo}-01`;

  try {
    const emp = (await prisma.$queryRaw<{ nombre: string; apellido: string | null }[]>`
      SELECT TRIM(nombre) AS nombre, NULLIF(TRIM(apellido), '') AS apellido FROM empleados WHERE "puntoDeVentaId" = ${c.pdvId} AND codigo = ${c.codigo} LIMIT 1`)[0];
    if (!emp) return NextResponse.json({ error: "Ese empleado no está en la nómina del PDV" }, { status: 404 });
    const pdvs = await prisma.puntoDeVenta.findMany({ select: { id: true, localId: true } });
    const localDe = new Map(pdvs.map((p) => [p.id, p.localId]));
    const ids = [c.pdvId, ...(c.reparto ?? []).filter((x) => x.pct > 0).map((x) => x.puntoDeVentaId)];
    if (ids.some((id) => localDe.get(id) == null)) return NextResponse.json({ error: "PDV desconocido" }, { status: 400 });

    const adelanto = (await prisma.$queryRaw<{ codigo: string; nombre: string }[]>(conceptoAdelantoSql))[0];
    if (!adelanto) return NextResponse.json({ error: "No existe el concepto de caja \"Adelanto Sueldo\"" }, { status: 400 });

    // Lo que ya tiene el empleado en el período (MaxiRest y Lazarillo).
    const movs = (await prisma.$queryRaw<MovimientoEmpleado[]>(movimientosEmpleadoSql(c.pdvId, c.codigo, emp.nombre, periodo)))
      .filter((m) => m.periodo === c.periodo);
    const adelantosPeriodo = Math.round(movs.filter((m) => m.cod === adelanto.codigo).reduce((s, m) => s + m.importe, 0) * 100) / 100;

    let conceptos = new Map<string, string>();
    if (c.tipo === "sueldo") {
      const problemas = validarSueldo(c, adelantosPeriodo);
      if (problemas.length) return NextResponse.json({ error: "No cierra", detalle: problemas }, { status: 400 });
      const cods = [...new Set(c.conceptos.map((x) => x.conceptoCodigo))];
      const cc = await prisma.conceptoCaja.findMany({ where: { codigo: { in: cods } }, select: { codigo: true, nombre: true } });
      conceptos = new Map(cc.map((x) => [x.codigo, x.nombre.trim()]));
      if (cods.some((x) => !conceptos.has(x))) return NextResponse.json({ error: "Hay un concepto que no existe" }, { status: 400 });
      // Nunca duplicar: si el período ya tiene liquidación (MaxiRest o Lazarillo) se avisa.
      const ya = movs.filter((m) => m.cod !== adelanto.codigo);
      if (ya.length && !c.forzar) {
        return NextResponse.json({ error: "Ya tiene sueldo cargado en el período", parecido: { importe: ya.reduce((s, m) => s + m.importe, 0), fecha: ya[0].fecha, origen: ya[0].origen } }, { status: 409 });
      }
    } else {
      const ya = movs.find((m) => m.cod === adelanto.codigo && m.fecha === c.fechaPago && Math.abs(m.importe - c.importe) <= 1);
      if (ya && !c.forzar) return NextResponse.json({ error: "Ya hay un adelanto igual ese día", parecido: { importe: ya.importe, fecha: ya.fecha, origen: ya.origen } }, { status: 409 });
    }

    const nombreCompleto = [emp.nombre, emp.apellido].filter(Boolean).join(" ");
    const total = c.tipo === "sueldo" ? c.total : c.importe;
    const res = await prisma.$transaction(async (tx) => {
      const [{ id }] = await tx.$queryRaw<{ id: number }[]>`
        INSERT INTO liquidaciones_empleado (tipo, "puntoDeVentaId", "localId", "empleadoCodigo", "empleadoNombre", periodo, "fechaPago", total, adelantos, payload, "creadoPor")
        VALUES (${c.tipo}, ${c.pdvId}, ${localDe.get(c.pdvId)!}, ${c.codigo}, ${emp.nombre}, ${periodo}::date, ${c.fechaPago}::date, ${total},
                ${c.tipo === "sueldo" ? adelantosPeriodo : 0}, ${JSON.stringify(c)}::jsonb, ${usuario})
        RETURNING id`;
      const filas = filasEmpleado(id, c);
      for (const f of filas) {
        const cod = f.conceptoCodigo || adelanto.codigo;
        const nom = f.conceptoCodigo ? conceptos.get(f.conceptoCodigo)! : adelanto.nombre;
        await tx.$executeRaw`
          INSERT INTO compras ("rowId", comprobante, "codCga", concepto, fecha, codigo, proveedor, observac, importe,
                               "localId", "puntoDeVentaId", "conceptoCodigo", "proveedorTextoNormalizado",
                               periodo, "fechaPago", "cajaPago", origen, "esBloqueado")
          VALUES (${f.rowId}, NULL, ${cod}, ${nom}, ${c.fechaPago}::timestamp, ${c.codigo}, ${emp.nombre},
                  ${c.tipo === "sueldo" ? "Liquidación (Lazarillo)" : "Adelanto (Lazarillo)"}, ${f.importe},
                  ${localDe.get(f.puntoDeVentaId)!}, ${f.puntoDeVentaId}, ${cod}, ${normalizarProveedorTexto(emp.nombre)},
                  ${periodo}::timestamp, ${c.fechaPago}::timestamp, ${f.medio}, ${ORIGEN_LAZARILLO}, ${f.bloqueada})`;
      }
      const $ = (n: number) => `$ ${n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      await registrarActividad(tx, {
        tipo: "empleado", accion: "creada",
        descripcion: `${nombreCompleto}\n${c.tipo === "sueldo" ? "Sueldo" : "Adelanto"} ${c.periodo.slice(5)}/${c.periodo.slice(0, 4)} · ${$(total)}`,
        refId: `emp-${id}`, localId: localDe.get(c.pdvId)!, usuario,
      });
      return { id, libres: filas.filter((f) => !f.bloqueada).map((f) => f.rowId) };
    });

    // Concepto fijo del empleado (si tiene) antes de la apertura.
    await aplicarConceptosEmpleado(prisma, { pdvId: c.pdvId }).catch((err: unknown) => console.error("[empleados] concepto fijo", err));
    // La regla de apertura del empleado, como a cualquier sueldo.
    const apertura = await reaplicarReglasActivas(prisma, { rowIds: res.libres }).catch((err: unknown) => ({ reglasReaplicadas: 0, errores: [String(err)] }));
    if (apertura.errores.length) console.error("[empleados] apertura", apertura.errores);
    return NextResponse.json({ ok: true, id: res.id, total });
  } catch (err) {
    if (err instanceof Rechazo) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[POST /api/empleados]", err);
    return NextResponse.json({ error: "No se pudo guardar" }, { status: 500 });
  }
}
