import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuthUser } from "@/lib/auth/require-auth";
import { PDV_ARCA } from "@/lib/arca/clasificar";
import { PERCEPCIONES } from "@/lib/arca/corregir";

export const dynamic = "force-dynamic";

// POST — Corregir con ARCA (Diego 28/10/2026). Todo se hace como corrección manual del Panel
// (fecha manual, importe manual), así una nueva lectura de MaxiRest no la pisa:
// - fecha:    las filas del comprobante toman la fecha de ARCA ("lo ajusta y fin").
// - numero:   el número no se puede pisar en lo que viene de MaxiRest (su pago del 80 lo tiene
//             con el número viejo): queda vinculada con ARCA (revisada) y se informa.
// - anular:   cargada dos veces → las filas del comprobante elegido quedan en $0 (no se borran).
// - restaurar: deshace un anular.
// - igualar:  importe distinto → la fila principal toma el neto + IVA de ARCA.
// - percepcion: falta una percepción → fila nueva del comprobante (origen "arca"), con el impuesto
//             que se elige (ARCA no lo informa). quitar: la borra (solo filas creadas acá).
const fila = z.string().min(6).max(40);
const schema = z.discriminatedUnion("accion", [
  z.object({ accion: z.literal("fecha"), items: z.array(z.object({ rowIds: z.array(fila).min(1).max(30), fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), key: z.string().max(60), nombre: z.string().max(200) })).min(1).max(300) }),
  z.object({ accion: z.literal("numero"), items: z.array(z.object({ key: z.string().regex(/^\d{11}-\d{1,3}-\d{1,5}-\d{1,8}$/), nombre: z.string().max(200) })).min(1).max(300) }),
  z.object({ accion: z.literal("anular"), rowIds: z.array(fila).min(1).max(30), nota: z.string().max(120) }),
  z.object({ accion: z.literal("restaurar"), rowId: fila }),
  z.object({ accion: z.literal("igualar"), rowId: fila, importe: z.number().finite(), key: z.string().max(60) }),
  z.object({ accion: z.literal("percepcion"), baseRowId: fila, cod: z.enum(["133", "899", "137"]), importe: z.number().positive().max(1e10) }),
  z.object({ accion: z.literal("quitar"), rowId: z.string().regex(/^arca-[0-9a-f-]{36}$/) }),
]);

export async function POST(request: NextRequest) {
  const { user, response } = await requireAuthUser();
  if (response) return response;
  const b = schema.safeParse(await request.json().catch(() => null));
  if (!b.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  const por = user.email ?? user.id;
  const d = b.data;
  try {
    if (d.accion === "fecha") {
      let filas = 0;
      for (const it of d.items) {
        filas += await prisma.$executeRaw`UPDATE compras SET "fechaManual" = ${it.fecha}::date WHERE "rowId" = ANY(${it.rowIds}::text[])`;
      }
      // Queda anotado en "Ya no van" (qué fecha tenía), por si hay que volverla atrás a mano.
      await prisma.sinCargaDescarte.createMany({
        data: d.items.filter((it) => /^\d{11}-\d{1,3}-\d{1,5}-\d{1,8}$/.test(it.key)).map((it) => ({ pdvId: PDV_ARCA, clave: `k:${it.key}`, nombre: it.nombre, creadoPor: por })),
        skipDuplicates: true,
      });
      return NextResponse.json({ ok: true, comprobantes: d.items.length, filas });
    }
    if (d.accion === "numero") {
      // Revisada: sale de Corregir (y como ya está apareada, tampoco figura como "sin cargar").
      await prisma.sinCargaDescarte.createMany({
        data: d.items.map((it) => ({ pdvId: PDV_ARCA, clave: `k:${it.key}`, nombre: it.nombre, creadoPor: por })),
        skipDuplicates: true,
      });
      return NextResponse.json({ ok: true, comprobantes: d.items.length });
    }
    if (d.accion === "anular") {
      await prisma.$transaction(async (tx) => {
        const ya = new Set((await tx.$queryRaw<{ rowId: string }[]>`
          SELECT "rowId" FROM compras_huerfanas WHERE "rowId" = ANY(${d.rowIds}::text[]) AND estado = 'aplicada'`).map((x) => x.rowId));
        const ids = d.rowIds.filter((id) => !ya.has(id));
        if (!ids.length) return;
        await tx.$executeRaw`
          INSERT INTO compras_huerfanas ("rowId", "puntoDeVentaId", fecha, comprobante, codigo, proveedor, concepto, importe,
                                         "importeManualAntes", "observacManualAntes", motivo, estado)
          SELECT "rowId", COALESCE("puntoDeVentaId", 0), fecha::date, comprobante, codigo, proveedor, concepto, importe,
                 "importeManual", "observacManual", 'duplicado_arca', 'aplicada'
          FROM compras WHERE "rowId" = ANY(${ids}::text[])
          ON CONFLICT ("rowId") DO UPDATE SET motivo = 'duplicado_arca', estado = 'aplicada',
            "importeManualAntes" = EXCLUDED."importeManualAntes", "observacManualAntes" = EXCLUDED."observacManualAntes", "actualizadaEn" = now()`;
        await tx.$executeRaw`
          UPDATE compras SET "importeManual" = 0, "observacManual" = ${d.nota} || COALESCE(' · ' || COALESCE("observacManual", observac), '')
          WHERE "rowId" = ANY(${ids}::text[])`;
      });
      return NextResponse.json({ ok: true });
    }
    if (d.accion === "restaurar") {
      const h = await prisma.$queryRaw<{ importeManualAntes: number | null; observacManualAntes: string | null }[]>`
        SELECT "importeManualAntes"::float8 AS "importeManualAntes", "observacManualAntes" FROM compras_huerfanas WHERE "rowId" = ${d.rowId} AND estado = 'aplicada'`;
      if (!h.length) return NextResponse.json({ error: "No estaba anulada" }, { status: 404 });
      await prisma.$transaction([
        prisma.$executeRaw`UPDATE compras SET "importeManual" = ${h[0].importeManualAntes}, "observacManual" = ${h[0].observacManualAntes} WHERE "rowId" = ${d.rowId}`,
        prisma.$executeRaw`UPDATE compras_huerfanas SET estado = 'restaurada', "actualizadaEn" = now() WHERE "rowId" = ${d.rowId}`,
      ]);
      return NextResponse.json({ ok: true });
    }
    if (d.accion === "percepcion") {
      const per = PERCEPCIONES.find((p) => p.cod === d.cod)!;
      const rowId = `arca-${crypto.randomUUID()}`;
      const col = d.cod === "133" ? "per1" : d.cod === "899" ? "per2" : "per3";
      const n = await prisma.$executeRaw`
        INSERT INTO compras ("rowId", comprobante, "codCga", concepto, fecha, codigo, proveedor, detalle, observac, importe,
                             per1, per2, per3, "localId", "puntoDeVentaId", "conceptoCodigo", "proveedorId", origen)
        SELECT ${rowId}, b.comprobante, ${d.cod}, ${per.nombre}, COALESCE(b."fechaManual", b.fecha), b.codigo, b.proveedor, b.detalle,
               ${"Percepción agregada desde ARCA por " + por}, ${d.importe},
               ${col === "per1" ? d.importe : 0}, ${col === "per2" ? d.importe : 0}, ${col === "per3" ? d.importe : 0},
               b."localId", b."puntoDeVentaId", (SELECT codigo FROM conceptos_caja WHERE codigo = ${d.cod}), b."proveedorId", 'arca'
        FROM compras b WHERE b."rowId" = ${d.baseRowId}`;
      if (!n) return NextResponse.json({ error: "No se encontró la factura" }, { status: 404 });
      return NextResponse.json({ ok: true, rowId });
    }
    if (d.accion === "quitar") {
      const n = await prisma.$executeRaw`DELETE FROM compras WHERE "rowId" = ${d.rowId} AND origen = 'arca'`;
      if (!n) return NextResponse.json({ error: "No se encontró" }, { status: 404 });
      return NextResponse.json({ ok: true });
    }
    // igualar
    const n = await prisma.$executeRaw`
      UPDATE compras SET "importeManual" = CASE WHEN COALESCE("importeManual", importe) < 0 THEN -ABS(${d.importe}::numeric) ELSE ABS(${d.importe}::numeric) END
      WHERE "rowId" = ${d.rowId}`;
    if (!n) return NextResponse.json({ error: "No se encontró la fila" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[POST /api/arca/corregir]", err);
    return NextResponse.json({ error: "No se pudo corregir." }, { status: 500 });
  }
}
