import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { requireAuth } from "@/lib/auth/require-auth";
import { mesSchema, yearSchema, idSchema, codigoSchema, textoLibreSchema } from "@/lib/dashboard/schemas";
import { monthsParam } from "@/lib/dashboard/params";
import { buildDetalleConditions } from "@/lib/dashboard/detalle-conditions";
import { recortarConHasMore } from "@/lib/dashboard/recortar-has-more";
import { DETALLE_COMPRAS_LIMITE } from "@/lib/dashboard/constants";
import { reshapeDetalle, type DetalleSqlRow } from "@/lib/dashboard/reshape-detalle";

export const dynamic = "force-dynamic";

// SELECT + JOINs compartidos entre la lista (WHERE dinámico, con el join
// cc_ef/rc_ef extra para filtrar por concepto/rubro efectivo) y el lookup
// puntual por distribucionId — antes esta forma se armaba a mano una tercera
// vez ahí, con su propio query anidado de Prisma en vez de reusar la vista
// v_compras_distribuidas + reshapeDetalle (hallazgo de code-review,
// 24-ago-2026): un campo nuevo tenía que agregarse en 3 lugares para no
// desincronizarse.
const DETALLE_SELECT_JOIN = Prisma.sql`
  SELECT
    c."rowId",
    c."distribucionId",
    (c."distribucionId" IS NOT NULL) AS "esDistribuido",
    COALESCE(cb."importeManual", cb.importe) AS "importeBase",
    c.fecha,
    c."fechaManual",
    c.importe,
    c."importeManual",
    c."conceptoCodigoManual",
    c.concepto,
    c.detalle,
    c.observac,
    c."observacManual",
    c.proveedor AS "proveedorTexto",
    p.id                AS "proveedorId",
    p.nombre            AS "proveedorNombre",
    p.razon             AS "proveedorRazon",
    l.nombre            AS "localNombre",
    pdv.nombre          AS "pdvNombre",
    c."localIdOrigen",
    c."puntoDeVentaIdOrigen",
    cc.codigo           AS "conceptoCajaCodigo",
    cc.nombre           AS "conceptoCajaNombre",
    rc.nombre           AS "conceptoCajaRubroNombre",
    ccm.codigo          AS "conceptoCajaManualCodigo",
    ccm.nombre          AS "conceptoCajaManualNombre",
    rcm.nombre          AS "conceptoCajaManualRubroNombre"
  FROM v_compras_distribuidas c
  -- Compra base: en una fila de fan-out la vista trae solo la fracción del
  -- destino, y el modal de edición necesita el total para poder corregirlo.
  JOIN compras cb                    ON cb."rowId" = c."rowId"
  LEFT JOIN proveedores p            ON c."proveedorId" = p.id
  LEFT JOIN locales l                ON c."localId" = l.id
  LEFT JOIN puntos_de_venta pdv      ON c."puntoDeVentaId" = pdv.id
  -- Concepto original y manual POR SEPARADO — para mostrar los dos objetos
  -- anidados que CompraDetalle espera (conceptoCaja / conceptoCajaManual).
  LEFT JOIN conceptos_caja cc           ON c."conceptoCodigo" = cc.codigo
  LEFT JOIN rubros_concepto_caja rc     ON cc."codRga" = rc.codigo
  LEFT JOIN conceptos_caja ccm          ON c."conceptoCodigoManual" = ccm.codigo
  LEFT JOIN rubros_concepto_caja rcm    ON ccm."codRga" = rcm.codigo
`;

export async function GET(request: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { searchParams } = new URL(request.url);

  const yearParsed = yearSchema.safeParse(searchParams.get("year") ?? new Date().getFullYear());
  const year = yearParsed.success ? yearParsed.data : new Date().getFullYear();

  const rowId = searchParams.get("rowId") ?? undefined;
  const distribucionIdRaw = searchParams.get("distribucionId");
  const distribucionId = distribucionIdRaw ? idSchema.safeParse(distribucionIdRaw).data : undefined;

  // Filtro por rowId puntual — se mantiene fuera de la vista (diseño sección
  // 4: este caso no migra a v_compras_distribuidas). Dos variantes:
  if (rowId) {
    // (a) Con distribucionId: el click vino de una fila de fan-out del pivot
    // (Task 5) — hay que devolver ESA porción puntual, no la compra completa.
    // Antes de este fix, esta rama ignoraba distribucionId por completo y
    // siempre devolvía la compra sin distribuir (fix Fase C, ver diseño
    // sección 4 "Resolución brainstorming Fase C").
    if (distribucionId !== undefined) {
      // Mismo SELECT/JOIN que la lista de abajo, vía v_compras_distribuidas
      // (que ya arma importe/local/puntoDeVenta del destino para la fila
      // distribuida) — antes esta rama armaba el objeto a mano con su propio
      // query anidado de Prisma, una forma que podía desincronizarse de
      // reshapeDetalle (hallazgo de code-review, 24-ago-2026).
      const rows = await prisma.$queryRaw<DetalleSqlRow[]>(Prisma.sql`
        ${DETALLE_SELECT_JOIN}
        WHERE c."rowId" = ${rowId} AND c."distribucionId" = ${distribucionId}
        LIMIT 1
      `);
      return NextResponse.json({ data: rows.map(reshapeDetalle), hasMore: false });
    }

    // (b) Sin distribucionId: comportamiento original intacto, usado por
    // compra-lineas/[compraId] y por la edición manual — ambos siempre
    // operan sobre la compra completa, nunca sobre una porción.
    const compra = await prisma.compra.findUnique({
      where: { rowId },
      select: {
        rowId: true,
        esDistribuido: true,
        fecha: true,
        importe: true,
        importeManual: true,
        fechaManual: true,
        conceptoCodigoManual: true,
        concepto: true,
        detalle: true,
        observac: true,
        observacManual: true,
        proveedor: true,
        proveedorRef: { select: { id: true, nombre: true, razon: true } },
        local: { select: { nombre: true } },
        puntoDeVenta: { select: { nombre: true } },
        conceptoCaja: { select: { codigo: true, nombre: true, rubro: { select: { nombre: true } } } },
        conceptoCajaManual: { select: { codigo: true, nombre: true, rubro: { select: { nombre: true } } } },
      },
    });
    return NextResponse.json({ data: compra ? [{ ...compra, distribucionId: null }] : [], hasMore: false });
  }

  const localId = idSchema.safeParse(searchParams.get("localId")).data;
  const pdvId = idSchema.safeParse(searchParams.get("pdvId")).data;
  const mes = mesSchema.safeParse(searchParams.get("mes")).data;
  const proveedorId = idSchema.safeParse(searchParams.get("proveedorId")).data;
  const proveedorTextoRaw = searchParams.get("proveedorTexto");
  const proveedorTexto = proveedorTextoRaw ? textoLibreSchema.safeParse(proveedorTextoRaw).data : undefined;
  const codigoRaw = searchParams.get("codigo");
  const codigo = codigoRaw ? codigoSchema.safeParse(codigoRaw).data : undefined;
  const sinProveedor = searchParams.get("sinProveedor") === "1";

  const conceptoCodigoRaw = searchParams.get("conceptoCodigo");
  const rubroCodigoRaw = searchParams.get("rubroCodigo");
  const conceptoCodigo = conceptoCodigoRaw ? codigoSchema.safeParse(conceptoCodigoRaw).data : undefined;
  const rubroCodigo = rubroCodigoRaw ? codigoSchema.safeParse(rubroCodigoRaw).data : undefined;
  const meses = monthsParam.safeParse(searchParams.get("months")).data;
  const observacionRaw = searchParams.get("observacionQuery");
  const observacionQuery = observacionRaw ? textoLibreSchema.safeParse(observacionRaw).data : undefined;

  const where = Prisma.join(
    buildDetalleConditions({
      year, localId, pdvId, mes, meses, proveedorId, proveedorTexto, codigo, sinProveedor,
      rubroCodigo, conceptoCodigo, observacionQuery,
    }),
    " AND "
  );

  try {
    const rows = await prisma.$queryRaw<DetalleSqlRow[]>(Prisma.sql`
      ${DETALLE_SELECT_JOIN}
      -- Concepto/rubro EFECTIVO — solo para filtrar (mismo criterio que pivot).
      LEFT JOIN conceptos_caja cc_ef        ON COALESCE(c."conceptoCodigoManual", c."conceptoCodigo") = cc_ef.codigo
      LEFT JOIN rubros_concepto_caja rc_ef  ON cc_ef."codRga" = rc_ef.codigo
      WHERE ${where}
      ORDER BY c.fecha ASC
      LIMIT ${DETALLE_COMPRAS_LIMITE + 1}
    `);

    const { data, hasMore } = recortarConHasMore(rows, DETALLE_COMPRAS_LIMITE);
    return NextResponse.json({ data: data.map(reshapeDetalle), hasMore });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
