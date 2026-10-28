import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuthUser } from "@/lib/auth/require-auth";
import { reaplicarReglasActivas } from "@/lib/apertura/motor";
import { RechazoPago } from "@/lib/pagos-proveedor/registrar";
import { prepararFactura, Duplicada } from "@/lib/facturas/guardar";
import { altaEnTx, pagoAhoraSchema } from "@/lib/facturas/alta";
import { GV_CODIGO, GV_NOMBRE, GV_PREFIJO, siguienteNumeroGV } from "@/lib/gastos-varios/periodo";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Alta de un gasto vario (Etapa 4): un Ticket interno del proveedor "Gastos Varios"
// (9999-NNNNNNNN) con un solo registro por concepto de caja, sin IVA. Con pago, se
// registra en la misma transacción (Financiera por fecha de pago); sin pago queda IMPAGO.
const gastoSchema = z.object({
  pdvId: z.number().int().positive(),
  conceptoCodigo: z.string().trim().min(1).max(20),
  detalle: z.string().trim().max(200).optional().nullable(),
  importe: z.number().positive().max(1e12),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  pago: pagoAhoraSchema.omit({ importe: true }).optional().nullable(),
  // Ya se avisó que hay uno parecido y se confirmó cargarlo igual.
  forzar: z.boolean().optional(),
});

class Rechazo extends Error { constructor(msg: string, readonly status = 400) { super(msg); } }

export async function POST(request: NextRequest) {
  const { user, response } = await requireAuthUser();
  if (response) return response;
  const usuario = user.email ?? user.id;

  const parsed = gastoSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos", detalle: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, { status: 400 });
  const g = parsed.data;
  const importe = Math.round(g.importe * 100) / 100;

  // Nunca duplicar: el mismo gasto (PDV + concepto + importe ±1 en el mismo mes) ya
  // cargado en MaxiRest o en Lazarillo → se avisa y se carga solo si se confirma.
  if (!g.forzar) {
    const parecido = await prisma.$queryRaw<{ fecha: string; importe: number; origen: string | null; observac: string | null }[]>`
      SELECT TO_CHAR(COALESCE(c."fechaManual", c.fecha), 'YYYY-MM-DD') AS fecha,
             COALESCE(c."importeManual", c.importe)::float8 AS importe, c.origen,
             COALESCE(c."observacManual", c.observac) AS observac
      FROM compras c
      WHERE c."puntoDeVentaId" = ${g.pdvId}
        AND COALESCE(c."conceptoCodigoManual", c."conceptoCodigo") = ${g.conceptoCodigo}
        AND ABS(COALESCE(c."importeManual", c.importe) - ${importe}::numeric) <= 1
        AND DATE_TRUNC('month', COALESCE(c."fechaManual", c.fecha)) = DATE_TRUNC('month', ${g.fecha}::date)
        AND (c.comprobante IS NULL OR UPPER(LEFT(c.comprobante, 1)) IN ('E', 'G') OR c.codigo = ${GV_CODIGO})
      LIMIT 1
    `;
    if (parecido.length) return NextResponse.json({ error: "Ya hay un gasto parecido", parecido: parecido[0] }, { status: 409 });
  }

  // El proveedor "Gastos Varios" se crea la primera vez (el import del maestro no lo borra).
  const gv = await prisma.proveedor.upsert({
    where: { codigo: GV_CODIGO }, update: {},
    create: { codigo: GV_CODIGO, nombre: GV_NOMBRE, razon: GV_NOMBRE },
    select: { id: true },
  });

  let res: { comprobante: string; total: number; rowId: string; numero: string; libres: string[]; pago: { id: number; aplicado: number; aCuenta: number } | null } | null = null;
  try {
    await prisma.$transaction(async (tx) => {
      // Numeración interna correlativa: un candado para que dos cargas a la vez no tomen el mismo número.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('gastos-varios:numero'))`;
      const mayor = await tx.$queryRaw<{ m: string | null }[]>`
        SELECT MAX(comprobante) AS m FROM compras
        WHERE codigo = ${GV_CODIGO} AND comprobante ~ ${`^Z${GV_PREFIJO}[0-9]{8}$`}
      `;
      const numero = siguienteNumeroGV(mayor[0]?.m);
      const concepto = await tx.conceptoCaja.findUnique({ where: { codigo: g.conceptoCodigo }, select: { nombre: true } });
      if (!concepto) throw new Rechazo("Ese concepto no existe.");
      const p = await prepararFactura(tx, {
        proveedorId: gv.id, tipo: "Ticket", prefijo: GV_PREFIJO, numero, fecha: g.fecha,
        observacion: g.detalle?.trim() || null,
        registros: [{ tipo: "concepto", conceptoCodigo: g.conceptoCodigo, nombre: concepto.nombre.trim(), neto: importe, alicuota: 0, impInt: 0, puntoDeVentaId: g.pdvId, reparto: null }],
        percepciones: [], impIntGeneral: 0,
      });
      if ("error" in p) throw new Rechazo([p.error, ...(p.detalle ?? [])].join(" · "), p.status);
      const total = p.armado.total;
      const pago = await altaEnTx(tx, p, g.pago ?? null, usuario, (pdv) =>
        `${GV_NOMBRE}\n${[concepto.nombre.trim(), g.detalle?.trim(), pdv, `$ ${total.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`].filter(Boolean).join(" · ")}`);
      res = {
        comprobante: p.armado.filas[0].comprobante, total, rowId: p.armado.filas[0].rowId, numero, pago,
        libres: p.armado.filas.filter((x) => !x.esBloqueado).map((x) => x.rowId),
      };
    });
  } catch (err) {
    if (err instanceof Rechazo) return NextResponse.json({ error: err.message }, { status: err.status });
    if (err instanceof RechazoPago) return NextResponse.json({ error: `No se guardó: ${err.message}` }, { status: 400 });
    if (err instanceof Duplicada || (err as { code?: string })?.code === "P2002") {
      return NextResponse.json({ error: "Ese número interno ya está usado: probá de nuevo." }, { status: 409 });
    }
    console.error("[gastos-varios] alta", err);
    return NextResponse.json({ error: "No se pudo guardar el gasto" }, { status: 500 });
  }
  const r = res!;

  // Reglas de apertura por concepto, como a cualquier compra.
  const apertura = await reaplicarReglasActivas(prisma, { rowIds: r.libres }).catch((err: unknown) => ({ reglasReaplicadas: 0, errores: [String(err)] }));
  if (apertura.errores.length) console.error("[gastos-varios] apertura", apertura.errores);

  return NextResponse.json({ ok: true, comprobante: r.comprobante, numero: `${GV_PREFIJO}-${r.numero}`, total: r.total, rowId: r.rowId, pago: r.pago });
}
