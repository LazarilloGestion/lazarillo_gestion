import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { requireAuth } from "@/lib/auth/require-auth";
import { mesSchema, yearSchema, idSchema, codigoSchema } from "@/lib/dashboard/schemas";
import { buildDateRange } from "@/lib/dashboard/query-builders";

export const dynamic = "force-dynamic";

interface DetalleSqlRow {
  rowId: string;
  distribucionId: number | null;
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

export async function GET(request: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { searchParams } = new URL(request.url);

  const yearParsed = yearSchema.safeParse(searchParams.get("year") ?? new Date().getFullYear());
  const year = yearParsed.success ? yearParsed.data : new Date().getFullYear();

  const rowId = searchParams.get("rowId") ?? undefined;

  // Filtro por rowId puntual (PK de compras, no de la vista) — se mantiene
  // sobre `compras` directo, sin cambios de comportamiento (diseño sección 4:
  // este caso no migra a la vista).
  if (rowId) {
    const compra = await prisma.compra.findUnique({
      where: { rowId },
      select: {
        rowId: true,
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
    return NextResponse.json({ data: compra ? [compra] : [] });
  }

  const localId = idSchema.safeParse(searchParams.get("localId")).data;
  const pdvId = idSchema.safeParse(searchParams.get("pdvId")).data;
  const mes = mesSchema.safeParse(searchParams.get("mes")).data;
  const proveedorId = idSchema.safeParse(searchParams.get("proveedorId")).data;

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

  // cc_ef/rc_ef (concepto EFECTIVO, mismo join que pivot usa: COALESCE(manual,
  // original)) es solo para filtrar — replica exactamente el comportamiento
  // original de detalle (Prisma: `OR: [{conceptoCodigoManual: X}, {conceptoCodigoManual: null, conceptoCodigo: X}]`)
  // y el de pivot. Filtrar por el concepto NO-coalescido sería un bug: una
  // compra reclasificada a mano a otro rubro/concepto dejaría de aparecer al
  // filtrar por su rubro nuevo, o seguiría apareciendo en el rubro viejo.
  if (rubroCodigo && !conceptoCodigo) {
    conditions.push(Prisma.sql`rc_ef.codigo = ${rubroCodigo}`);
  } else if (conceptoCodigo) {
    conditions.push(Prisma.sql`COALESCE(cc_ef.codigo, '__sin_concepto') = ${conceptoCodigo}`);
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

  const rows = await prisma.$queryRaw<DetalleSqlRow[]>(Prisma.sql`
    SELECT
      c."rowId",
      c."distribucionId",
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
    -- Concepto/rubro EFECTIVO — solo para filtrar (mismo criterio que pivot).
    LEFT JOIN conceptos_caja cc_ef        ON COALESCE(c."conceptoCodigoManual", c."conceptoCodigo") = cc_ef.codigo
    LEFT JOIN rubros_concepto_caja rc_ef  ON cc_ef."codRga" = rc_ef.codigo
    -- Concepto original y manual POR SEPARADO — para mostrar los dos objetos
    -- anidados que CompraDetalle espera (conceptoCaja / conceptoCajaManual).
    LEFT JOIN conceptos_caja cc           ON c."conceptoCodigo" = cc.codigo
    LEFT JOIN rubros_concepto_caja rc     ON cc."codRga" = rc.codigo
    LEFT JOIN conceptos_caja ccm          ON c."conceptoCodigoManual" = ccm.codigo
    LEFT JOIN rubros_concepto_caja rcm    ON ccm."codRga" = rcm.codigo
    WHERE ${where}
    ORDER BY c.fecha ASC
    LIMIT 2000
  `);

  return NextResponse.json({ data: rows.map(reshapeDetalle) });
}
