import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { requireAuth } from "@/lib/auth/require-auth";
import { mesSchema, yearSchema, idSchema, codigoSchema, textoLibreSchema } from "@/lib/dashboard/schemas";
import { buildDateRange } from "@/lib/dashboard/query-builders";

export const dynamic = "force-dynamic";

interface DetalleSqlRow {
  rowId: string;
  distribucionId: number | null;
  esDistribuido: boolean;
  fecha: Date | null;
  fechaManual: Date | null;
  importe: Prisma.Decimal | null;
  importeManual: Prisma.Decimal | null;
  conceptoCodigoManual: string | null;
  concepto: string | null;
  detalle: string | null;
  observac: string | null;
  observacManual: string | null;
  proveedorTexto: string | null;
  proveedorId: number | null;
  proveedorNombre: string | null;
  proveedorRazon: string | null;
  localNombre: string | null;
  pdvNombre: string | null;
  localIdOrigen: number | null;
  puntoDeVentaIdOrigen: number | null;
  conceptoCajaCodigo: string | null;
  conceptoCajaNombre: string | null;
  conceptoCajaRubroNombre: string | null;
  conceptoCajaManualCodigo: string | null;
  conceptoCajaManualNombre: string | null;
  conceptoCajaManualRubroNombre: string | null;
}

function reshapeDetalle(r: DetalleSqlRow) {
  return {
    rowId: r.rowId,
    // distribucionId: null cuando la compra no está distribuida (100% de los
    // casos hasta que exista una regla activa — Fase B no la puede crear sin
    // pasar por la API, ver Task 9). rowId se mantiene SIEMPRE como el de la
    // compra original (no un compuesto) — compra-lineas/[compraId] y el
    // endpoint puntual de compras/[rowId] siguen necesitando el rowId real
    // para funcionar. Fase C es quien debe usar `distribucionId ?? rowId`
    // como key de UI una vez que existan filas distribuidas (riesgo anotado
    // en la sección 4 del diseño, "Riesgo para Fase C").
    distribucionId: r.distribucionId,
    esDistribuido: r.esDistribuido,
    fecha: r.fecha,
    importe: r.importe,
    importeManual: r.importeManual,
    fechaManual: r.fechaManual,
    conceptoCodigoManual: r.conceptoCodigoManual,
    concepto: r.concepto,
    detalle: r.detalle,
    observac: r.observac,
    observacManual: r.observacManual,
    proveedor: r.proveedorTexto,
    proveedorRef: r.proveedorId != null ? { id: r.proveedorId, nombre: r.proveedorNombre, razon: r.proveedorRazon } : null,
    local: r.localNombre != null ? { nombre: r.localNombre } : null,
    puntoDeVenta: r.pdvNombre != null ? { nombre: r.pdvNombre } : null,
    localIdOrigen: r.localIdOrigen,
    puntoDeVentaIdOrigen: r.puntoDeVentaIdOrigen,
    conceptoCaja:
      r.conceptoCajaCodigo != null
        ? { codigo: r.conceptoCajaCodigo, nombre: r.conceptoCajaNombre, rubro: r.conceptoCajaRubroNombre != null ? { nombre: r.conceptoCajaRubroNombre } : null }
        : null,
    conceptoCajaManual:
      r.conceptoCajaManualCodigo != null
        ? {
            codigo: r.conceptoCajaManualCodigo,
            nombre: r.conceptoCajaManualNombre,
            rubro: r.conceptoCajaManualRubroNombre != null ? { nombre: r.conceptoCajaManualRubroNombre } : null,
          }
        : null,
  };
}

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
      return NextResponse.json({ data: rows.map(reshapeDetalle) });
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
    return NextResponse.json({ data: compra ? [{ ...compra, distribucionId: null }] : [] });
  }

  const localId = idSchema.safeParse(searchParams.get("localId")).data;
  const pdvId = idSchema.safeParse(searchParams.get("pdvId")).data;
  const mes = mesSchema.safeParse(searchParams.get("mes")).data;
  const proveedorId = idSchema.safeParse(searchParams.get("proveedorId")).data;
  const proveedorTextoRaw = searchParams.get("proveedorTexto");
  const proveedorTexto = proveedorTextoRaw ? textoLibreSchema.safeParse(proveedorTextoRaw).data : undefined;
  const sinProveedor = searchParams.get("sinProveedor") === "1";

  const conceptoCodigoRaw = searchParams.get("conceptoCodigo");
  const rubroCodigoRaw = searchParams.get("rubroCodigo");
  const conceptoCodigo = conceptoCodigoRaw ? codigoSchema.safeParse(conceptoCodigoRaw).data : undefined;
  const rubroCodigo = rubroCodigoRaw ? codigoSchema.safeParse(rubroCodigoRaw).data : undefined;

  const { fechaStart, fechaEnd } = buildDateRange(year, mes);

  const conditions: Prisma.Sql[] = [
    Prisma.sql`COALESCE(c."fechaManual", c.fecha) >= ${fechaStart} AND COALESCE(c."fechaManual", c.fecha) < ${fechaEnd}`,
    Prisma.sql`(c.fecha IS NOT NULL OR c."fechaManual" IS NOT NULL)`,
    Prisma.sql`COALESCE(c."importeManual", c.importe) IS NOT NULL AND COALESCE(c."importeManual", c.importe) != 0`,
  ];
  if (localId !== undefined) conditions.push(Prisma.sql`c."localId" = ${localId}`);
  if (pdvId !== undefined) conditions.push(Prisma.sql`c."puntoDeVentaId" = ${pdvId}`);
  if (proveedorId !== undefined) conditions.push(Prisma.sql`p.id = ${proveedorId}`);
  else if (proveedorTexto !== undefined) conditions.push(Prisma.sql`c."proveedorId" IS NULL AND c.proveedor = ${proveedorTexto}`);
  else if (sinProveedor) conditions.push(Prisma.sql`c."proveedorId" IS NULL AND c.proveedor IS NULL`);

  // cc_ef/rc_ef (concepto EFECTIVO, mismo join que pivot usa: COALESCE(manual,
  // original)) es solo para filtrar — replica exactamente el comportamiento
  // original de detalle (Prisma: `OR: [{conceptoCodigoManual: X}, {conceptoCodigoManual: null, conceptoCodigo: X}]`)
  // y el de pivot. Filtrar por el concepto NO-coalescido sería un bug: una
  // compra reclasificada a mano a otro rubro/concepto dejaría de aparecer al
  // filtrar por su rubro nuevo, o seguiría apareciendo en el rubro viejo.
  if (rubroCodigo && !conceptoCodigo) {
    conditions.push(Prisma.sql`rc_ef.codigo = ${rubroCodigo}`);
  } else if (conceptoCodigo) {
    conditions.push(Prisma.sql`COALESCE(c."conceptoCodigoManual", c."conceptoCodigo") = ${conceptoCodigo}`);
  } else {
    // Sin filtro de rubro/concepto: excluir rubros ocultos. A diferencia de
    // los dos filtros de arriba, esta rama del detalle ORIGINAL (antes de
    // este plan) usa el concepto NO-manual (`conceptoCaja`/`conceptoCodigo`
    // en el Prisma.CompraWhereInput anterior) para decidir visibilidad, no el
    // efectivo — replicar exactamente, no "corregir" una inconsistencia que
    // ya existía y está fuera de alcance de este plan.
    conditions.push(Prisma.sql`(rc."visibleEnDashboard" = true OR c."conceptoCodigo" IS NULL)`);
  }

  const where = Prisma.join(conditions, " AND ");

  try {
    const rows = await prisma.$queryRaw<DetalleSqlRow[]>(Prisma.sql`
      ${DETALLE_SELECT_JOIN}
      -- Concepto/rubro EFECTIVO — solo para filtrar (mismo criterio que pivot).
      LEFT JOIN conceptos_caja cc_ef        ON COALESCE(c."conceptoCodigoManual", c."conceptoCodigo") = cc_ef.codigo
      LEFT JOIN rubros_concepto_caja rc_ef  ON cc_ef."codRga" = rc_ef.codigo
      WHERE ${where}
      ORDER BY c.fecha ASC
      LIMIT 2000
    `);

    return NextResponse.json({ data: rows.map(reshapeDetalle) });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
