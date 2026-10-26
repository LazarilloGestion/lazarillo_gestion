import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { requireAuth } from "@/lib/auth/require-auth";
import { mesSchema, yearSchema, idSchema, codigoSchema, textoLibreSchema } from "@/lib/dashboard/schemas";
import { monthsParam, parseObservacionQuery, parseImporteQuery } from "@/lib/dashboard/params";
import { buildDetalleConditions } from "@/lib/dashboard/detalle-conditions";
import { fuenteCompras } from "@/lib/dashboard/fuente-compras";
import { recortarConHasMore } from "@/lib/dashboard/recortar-has-more";
import { DETALLE_COMPRAS_LIMITE } from "@/lib/dashboard/constants";
import { reshapeDetalle, type DetalleSqlRow } from "@/lib/dashboard/reshape-detalle";
import { claveComprobante } from "@/lib/cta-cte/estado";
import { estadosDePago, type EstadoFila } from "@/lib/cta-cte/query";

export const dynamic = "force-dynamic";

// Normalización del buscador igual a la del cliente (minúsculas, sin acentos).
const ACENTOS = "áàäâãéèëêíìïîóòöôõúùüûñç";
const SIN_ACENTOS = "aaaaaeeeeiiiiooooouuuunc";
function normalizarTexto(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}

// SELECT + JOINs compartidos entre la lista (WHERE dinámico, con el join
// cc_ef/rc_ef extra para filtrar por concepto/rubro efectivo) y el lookup
// puntual por distribucionId — antes esta forma se armaba a mano una tercera
// vez ahí, con su propio query anidado de Prisma en vez de reusar la vista
// v_compras_distribuidas + reshapeDetalle (hallazgo de code-review,
// 24-ago-2026): un campo nuevo tenía que agregarse en 3 lugares para no
// desincronizarse.
// `fuente`: compras según el switch Económica / Financiera (ver fuente-compras.ts).
// fecha/importe son los de la COMPRA (los que corrige el modal de edición);
// fechaVista/importeVista, los que cuentan en la vista elegida (en Financiera, el
// pago y la parte que cubre).
const detalleSelectJoin = (fuente: Prisma.Sql) => Prisma.sql`
  SELECT
    c."rowId",
    c."distribucionId",
    (c."distribucionId" IS NOT NULL) AS "esDistribuido",
    COALESCE(cb."importeManual", cb.importe) AS "importeBase",
    cb.fecha,
    cb."fechaManual",
    CASE WHEN c."distribucionId" IS NULL THEN cb.importe ELSE da."importeCalculado" END AS importe,
    CASE WHEN c."distribucionId" IS NULL THEN cb."importeManual" END AS "importeManual",
    COALESCE(c."fechaManual", c.fecha)     AS "fechaVista",
    COALESCE(c."importeManual", c.importe) AS "importeVista",
    c."pagoRef",
    -- Fecha de gasto (económica: la editada en Lazarillo, el período de un sueldo
    -- o la del comprobante) y fecha de pago (el pago de esta fila en Financiera;
    -- si no, la de un gasto vario/sueldo; la de una factura sale del 80, abajo).
    COALESCE(cb."fechaManual", cb.periodo, cb.fecha) AS "fechaGasto",
    COALESCE(CASE WHEN c."pagoRef" IS NOT NULL THEN c.fecha END, cb."fechaPago") AS "fechaPago",
    cb."cajaPago",
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
    rcm.nombre          AS "conceptoCajaManualRubroNombre",
    -- Para el semáforo y la cuenta corriente: el comprobante es de la compra base.
    cb.comprobante      AS "comprobante",
    cb.codigo           AS "codigoProveedor",
    cb."puntoDeVentaId" AS "pdvCompraId"
  FROM ${fuente} c
  -- Compra base: en una fila de fan-out la vista trae solo la fracción del
  -- destino, y el modal de edición necesita el total para poder corregirlo.
  JOIN compras cb                    ON cb."rowId" = c."rowId"
  LEFT JOIN distribuciones_apertura da ON da.id = c."distribucionId"
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

// Semáforo: estado de pago del comprobante de cada fila (14 cruzado con el 80).
// Si falla, la lista sale igual sin estado.
type FilaConClave = {
  comprobante?: string | null; codigoProveedor?: string | null; pdvCompraId?: number | null;
  fecha?: Date | null; fechaManual?: Date | null;
  fechaPago?: Date | string | null; pagoRef?: string | null;
};
async function conEstado<T extends FilaConClave>(filas: T[]): Promise<(T & { estadoPago: EstadoFila | null })[]> {
  const iso = (f: FilaConClave) => (f.fechaManual ?? f.fecha)?.toISOString().slice(0, 10) ?? null;
  let estados = new Map<string, EstadoFila>();
  try {
    estados = await estadosDePago(filas.map((f) => ({
      pdvId: f.pdvCompraId ?? null, comprobante: f.comprobante ?? null, codigo: f.codigoProveedor ?? null, fecha: iso(f),
    })));
  } catch (err) {
    console.error("[detalle] estado de pago", err);
  }
  return filas.map((f) => {
    const k = claveComprobante(f.pdvCompraId ?? null, f.comprobante ?? null, f.codigoProveedor ?? null);
    const estado = (k && estados.get(k)) || null;
    // Factura en Económica: fecha del último pago del 80 (en Financiera cada fila ya es un pago).
    const fechaPago = f.fechaPago ?? (!f.pagoRef && estado?.ultimoPago ? estado.ultimoPago : null);
    return { ...f, fechaPago, estadoPago: estado };
  });
}

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
        ${detalleSelectJoin(fuenteCompras(undefined))}
        WHERE c."rowId" = ${rowId} AND c."distribucionId" = ${distribucionId}
        LIMIT 1
      `);
      return NextResponse.json({ data: await conEstado(rows.map(reshapeDetalle)), hasMore: false });
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
        comprobante: true,
        codigo: true,
        puntoDeVentaId: true,
        proveedorRef: { select: { id: true, nombre: true, razon: true } },
        local: { select: { nombre: true } },
        puntoDeVenta: { select: { nombre: true } },
        conceptoCaja: { select: { codigo: true, nombre: true, rubro: { select: { nombre: true } } } },
        conceptoCajaManual: { select: { codigo: true, nombre: true, rubro: { select: { nombre: true } } } },
      },
    });
    if (!compra) return NextResponse.json({ data: [], hasMore: false });
    const { codigo, puntoDeVentaId, ...resto } = compra;
    const fila = { ...resto, distribucionId: null, codigoProveedor: codigo, pdvCompraId: puntoDeVentaId };
    return NextResponse.json({ data: await conEstado([fila]), hasMore: false });
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
  const observacionQuery = parseObservacionQuery(searchParams.get("observacionQuery"));
  const importeQuery = parseImporteQuery(searchParams.get("importeQuery"));
  const historico = searchParams.get("historico") === "1";
  const modo = searchParams.get("modo") === "financiera" ? "financiera" as const : undefined;
  // Buscador del modal (Año / Histórico): mismo criterio que el filtro de la
  // tabla — algún campo contiene el texto, sin mayúsculas ni acentos.
  const qRaw = (searchParams.get("q") ?? "").trim().slice(0, 80);
  const q = normalizarTexto(qRaw);

  const condiciones = buildDetalleConditions({
    year, localId, pdvId, mes, meses, proveedorId, proveedorTexto, codigo, sinProveedor,
    rubroCodigo, conceptoCodigo, observacionQuery, importeQuery, historico,
  });
  if (q) {
    const campos = [
      Prisma.sql`c.proveedor`, Prisma.sql`p.nombre`, Prisma.sql`p.razon`, Prisma.sql`c."observacManual"`,
      Prisma.sql`c.observac`, Prisma.sql`c.detalle`, Prisma.sql`c.concepto`, Prisma.sql`cc_ef.nombre`,
      Prisma.sql`rc_ef.nombre`, Prisma.sql`l.nombre`,
    ];
    const patron = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    condiciones.push(Prisma.sql`(${Prisma.join(
      campos.map((f) => Prisma.sql`translate(lower(COALESCE(${f}, '')), ${ACENTOS}, ${SIN_ACENTOS}) LIKE ${patron}`),
      " OR "
    )})`);
  }
  const where = Prisma.join(condiciones, " AND ");

  try {
    const rows = await prisma.$queryRaw<DetalleSqlRow[]>(Prisma.sql`
      ${detalleSelectJoin(fuenteCompras(modo))}
      -- Concepto/rubro EFECTIVO — solo para filtrar (mismo criterio que pivot).
      LEFT JOIN conceptos_caja cc_ef        ON COALESCE(c."conceptoCodigoManual", c."conceptoCodigo") = cc_ef.codigo
      LEFT JOIN rubros_concepto_caja rc_ef  ON cc_ef."codRga" = rc_ef.codigo
      WHERE ${where}
      -- Fecha efectiva (con manual) + desempate por id: define qué filas
      -- sobreviven al corte de DETALLE_COMPRAS_LIMITE, debe ser estable. Si hay
      -- que cortar, quedan los MÁS NUEVOS (antes quedaban los más viejos y en
      -- Histórico no aparecía lo último); después se devuelven en orden ascendente.
      ORDER BY COALESCE(c."fechaManual", c.fecha) DESC, c."rowId" DESC, c."distribucionId" DESC NULLS LAST, c."pagoRef" DESC NULLS LAST
      LIMIT ${DETALLE_COMPRAS_LIMITE + 1}
    `);

    const { data, hasMore } = recortarConHasMore(rows, DETALLE_COMPRAS_LIMITE);
    return NextResponse.json({ data: await conEstado(data.reverse().map(reshapeDetalle)), hasMore });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
