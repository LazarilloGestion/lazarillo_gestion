import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth/require-auth";
import { armarFactura, facturaSchema, CONCEPTO_PERCEPCION, ORIGEN_LAZARILLO } from "@/lib/facturas/armar";
import { reaplicarReglasActivas } from "@/lib/apertura/motor";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Alta de una factura desde el Panel (Etapa 4, punto 1). Se guarda como la
// traería MaxiRest (ver lib/facturas/armar.ts) con origen 'lazarillo'.
export async function POST(request: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const parsed = facturaSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos", detalle: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, { status: 400 });
  }
  const f = parsed.data;

  const proveedor = await prisma.proveedor.findUnique({ where: { id: f.proveedorId }, select: { id: true, codigo: true, nombre: true, razon: true } });
  if (!proveedor) return NextResponse.json({ error: "Proveedor inexistente" }, { status: 400 });

  const pdvs = await prisma.puntoDeVenta.findMany({ select: { id: true, localId: true } });
  const usados = new Set<number>(f.registros.flatMap((r) => [r.puntoDeVentaId, ...(r.reparto ?? []).map((x) => x.puntoDeVentaId)]));
  if ([...usados].some((id) => !pdvs.some((p) => p.id === id))) return NextResponse.json({ error: "PDV inexistente" }, { status: 400 });

  const codigos = [...new Set([...f.registros.map((r) => r.conceptoCodigo), ...f.percepciones.map((p) => CONCEPTO_PERCEPCION[p.tipo])])];
  const conceptos = await prisma.conceptoCaja.findMany({ where: { codigo: { in: codigos } }, select: { codigo: true, nombre: true } });
  const faltan = codigos.filter((c) => !conceptos.some((x) => x.codigo === c));
  if (faltan.length) return NextResponse.json({ error: `Concepto de caja inexistente: ${faltan.join(", ")}` }, { status: 400 });

  let armado;
  try {
    armado = armarFactura(f, { proveedor, pdvs, conceptos });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "No se pudo armar la factura" }, { status: 400 });
  }
  if (!armado.filas.length) return NextResponse.json({ error: "La factura no tiene importe" }, { status: 400 });

  // Nunca duplicar: si el comprobante ya está (de MaxiRest o de Lazarillo) en
  // alguno de los locales de la factura, no se vuelve a cargar.
  const locales = [...new Set(armado.filas.map((x) => x.localId))];
  const comprobante = armado.filas[0].comprobante;
  const ya = await prisma.$queryRaw<{ n: number }[]>`
    SELECT COUNT(*)::int AS n FROM compras
    WHERE "localId" = ANY(${locales}::int[]) AND comprobante = ${comprobante} AND codigo = ${proveedor.codigo}
  `;
  if (ya[0]?.n) return NextResponse.json({ error: "Esta factura ya está cargada" }, { status: 409 });

  const nombreProv = proveedor.nombre ?? proveedor.razon ?? proveedor.codigo;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO compras (
          "rowId", comprobante, "codCga", concepto, fecha, codigo, proveedor, detalle, observac,
          importe, "importeTrabajado", "impInt", per1, per2, per3,
          "proveedorId", "conceptoCodigo", "localId", "puntoDeVentaId", "esBloqueado", origen
        ) VALUES ${Prisma.join(armado.filas.map((x) => Prisma.sql`(
          ${x.rowId}, ${x.comprobante}, ${x.codCga}, ${x.concepto}, ${x.fecha}::date, ${x.codigo}, ${nombreProv}, ${x.detalle}, ${x.observac},
          ${x.importe}::numeric, ${x.importe}::numeric, ${x.impInt}::numeric, ${x.per1}::numeric, ${x.per2}::numeric, ${x.per3}::numeric,
          ${x.proveedorId}::int, ${x.conceptoCodigo}, ${x.localId}::int, ${x.puntoDeVentaId}::int, ${x.esBloqueado}, ${ORIGEN_LAZARILLO}
        )`))}
      `);
      if (armado.lineas.length) {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO detalle_compras (
            "rowId", "codPro", "codCpb", numero1, numero2, comprobante, fecha, codigo, nombre, medida,
            cantidad, neto, "totalIns", "ivaTot", "impNtTot", tasa, "codCga", "nomCga", "compraId", "proveedorId", "localId", origen
          ) VALUES ${Prisma.join(armado.lineas.map((l) => Prisma.sql`(
            ${l.rowId}, ${l.codPro}, ${l.codCpb}, ${l.numero1}, ${l.numero2}, ${l.comprobante}, ${l.fecha}::date, ${l.codigo}, ${l.nombre}, ${l.medida},
            ${l.cantidad}::numeric, ${l.neto}::numeric, ${l.totalIns}::numeric, ${l.ivaTot}::numeric, ${l.impNtTot}::numeric, ${l.tasa}::numeric,
            ${l.codCga}, ${l.nomCga}, ${l.compraId}, ${l.proveedorId}::int, ${l.localId}::int, ${ORIGEN_LAZARILLO}
          )`))}
        `);
      }
    });
  } catch (err) {
    console.error("[facturas] alta", err);
    return NextResponse.json({ error: "No se pudo guardar la factura" }, { status: 500 });
  }

  // Reglas de apertura (por concepto / proveedor) como a cualquier compra importada;
  // las filas con reparto explícito por PDV quedan bloqueadas y no se tocan.
  const libres = armado.filas.filter((x) => !x.esBloqueado).map((x) => x.rowId);
  const apertura = await reaplicarReglasActivas(prisma, { rowIds: libres }).catch((err: unknown) => ({ reglasReaplicadas: 0, errores: [String(err)] }));
  if (apertura.errores.length) console.error("[facturas] apertura", apertura.errores);

  return NextResponse.json({ ok: true, comprobante, total: armado.total, filas: armado.filas.length, lineas: armado.lineas.length });
}
