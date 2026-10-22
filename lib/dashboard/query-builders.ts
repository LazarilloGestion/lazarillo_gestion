import { Prisma } from "@prisma/client";
import { SIN_RUBRO_VISIBILIDAD_DEFAULT, VISIBILIDAD_FIELDS, type VisibilidadField } from "./constants";
import { ACENTOS_DESDE, ACENTOS_HACIA, quitarAcentos } from "./observacion-busqueda";
import { parsearImporte } from "./importe-busqueda";

export function buildDateRange(year: number, mes?: number): { fechaStart: Date; fechaEnd: Date } {
  const fechaStart = mes ? new Date(Date.UTC(year, mes - 1, 1)) : new Date(Date.UTC(year, 0, 1));
  const fechaEnd   = mes ? new Date(Date.UTC(year, mes, 1))     : new Date(Date.UTC(year + 1, 0, 1));
  return { fechaStart, fechaEnd };
}

interface PivotConditionParams {
  // Sin año no se acota por año: lo usa la búsqueda, que recorre todos los años.
  year?: number;
  tableAlias: string;
  hasFechaManual?: boolean;
  hasImporteManual?: boolean;
  localId?: number;
  pdvId?: number;
  months?: number[];
  rubroCodigo?: string;
  conceptoCodigo?: string;
  proveedorId?: number;
  observacionQuery?: string;
  // Texto tal como se tipeó en el palette ("811.980", "811980,50"); se parsea acá.
  importeQuery?: string;
  filterRubrosOcultos?: boolean;
  visibilidadCol?: VisibilidadField;
}

// Flag de visibilidad del bucket "Sin Rubro" (sin_rubro_config, una sola fila). COALESCE al default
// si la fila falta: ante una config rota preferimos mostrar el dato antes que ocultarlo en silencio.
// El literal del default sale de una constante nuestra (no de input), por eso va con Prisma.raw.
export function sinRubroVisibleSql(col: VisibilidadField): Prisma.Sql {
  const safe: VisibilidadField = VISIBILIDAD_FIELDS.includes(col) ? col : "visibleEnDashboard";
  const fallback = SIN_RUBRO_VISIBILIDAD_DEFAULT[safe] ? "true" : "false";
  return Prisma.sql`COALESCE((SELECT s."${Prisma.raw(safe)}" FROM sin_rubro_config s WHERE s.id = 1), ${Prisma.raw(fallback)})`;
}

// Búsqueda por contenido en la observación efectiva (manual si existe), sin acentos de ningún lado y
// con los comodines de LIKE escapados. Compartida entre el pivot y el detalle: si filtraran distinto,
// la suma del modal no coincidiría con el total clickeado.
export function observacionCondition(t: string, query: string): Prisma.Sql {
  const q = `%${quitarAcentos(query).replace(/[%_\\]/g, "\\$&")}%`;
  return Prisma.sql`translate(COALESCE(${Prisma.raw(t)}."observacManual", ${Prisma.raw(t)}.observac), ${ACENTOS_DESDE}, ${ACENTOS_HACIA}) ILIKE ${q}`;
}

// Búsqueda por importe (punto 9 de Etapa 3): compras cuyo importe COMPLETO coincide con lo
// tipeado — exacto si se tiparon centavos, por parte entera si no; el signo se ignora para
// encontrar también notas de crédito. Va por subconsulta sobre `compras` y no sobre el alias:
// en v_compras_distribuidas una compra aperturada aparece con la parte de cada destino, y lo
// que se rastrea es el total del gasto (el que figura en el banco). Compartida entre pivot,
// detalle y el buscador. Devuelve null si lo tipeado no es un importe (se ignora el filtro).
export function importeCondition(t: string, query: string): Prisma.Sql | null {
  const buscado = parsearImporte(query);
  if (!buscado) return null;
  const valor = new Prisma.Decimal(buscado.valor);
  const abs = Prisma.sql`ABS(COALESCE(co."importeManual", co.importe))`;
  const match = buscado.conCentavos
    ? Prisma.sql`${abs} = ${valor}`
    : Prisma.sql`${abs} >= ${valor} AND ${abs} < ${valor.plus(1)}`;
  return Prisma.sql`${Prisma.raw(t)}."rowId" IN (SELECT co."rowId" FROM compras co WHERE ${match})`;
}

export function buildPivotConditions({
  year,
  tableAlias: t,
  hasFechaManual = true,
  hasImporteManual = true,
  localId,
  pdvId,
  months,
  rubroCodigo,
  conceptoCodigo,
  proveedorId,
  observacionQuery,
  importeQuery,
  filterRubrosOcultos = false,
  visibilidadCol = "visibleEnDashboard",
}: PivotConditionParams): Prisma.Sql[] {
  const fechaExpr = hasFechaManual
    ? Prisma.sql`COALESCE(${Prisma.raw(t)}."fechaManual", ${Prisma.raw(t)}.fecha)`
    : Prisma.sql`${Prisma.raw(t)}.fecha`;

  const dateGuard = hasFechaManual
    ? Prisma.sql`(${Prisma.raw(t)}.fecha IS NOT NULL OR ${Prisma.raw(t)}."fechaManual" IS NOT NULL)`
    : Prisma.sql`${Prisma.raw(t)}.fecha IS NOT NULL`;

  const importeExpr = hasImporteManual
    ? Prisma.sql`COALESCE(${Prisma.raw(t)}."importeManual", ${Prisma.raw(t)}.importe)`
    : Prisma.sql`${Prisma.raw(t)}.importe`;

  const conditions: Prisma.Sql[] = [
    dateGuard,
    Prisma.sql`${Prisma.raw(t)}.importe IS NOT NULL`,
    Prisma.sql`${importeExpr} != 0`,
  ];
  if (year !== undefined) conditions.unshift(Prisma.sql`EXTRACT(YEAR FROM ${fechaExpr}) = ${year}`);
  if (localId) conditions.push(Prisma.sql`${Prisma.raw(t)}."localId" = ${localId}`);
  if (pdvId) conditions.push(Prisma.sql`${Prisma.raw(t)}."puntoDeVentaId" = ${pdvId}`);
  if (months?.length) {
    conditions.push(
      Prisma.sql`EXTRACT(MONTH FROM ${fechaExpr})::int IN (${Prisma.join(months.map((m) => Prisma.sql`${m}`))})`
    );
  }
  if (rubroCodigo) {
    conditions.push(Prisma.sql`COALESCE(rc.codigo, '__sin_rubro') = ${rubroCodigo}`);
  } else if (filterRubrosOcultos) {
    // Whitelist estricta: visibilidadCol nunca debe construirse a partir de un string arbitrario del request.
    const col: VisibilidadField = VISIBILIDAD_FIELDS.includes(visibilidadCol as VisibilidadField)
      ? (visibilidadCol as VisibilidadField)
      : "visibleEnDashboard";
    conditions.push(
      Prisma.sql`(rc."${Prisma.raw(col)}" = true OR (rc.codigo IS NULL AND ${sinRubroVisibleSql(col)}))`
    );
  }
  if (conceptoCodigo) conditions.push(Prisma.sql`COALESCE(cc.codigo, '__sin_concepto') = ${conceptoCodigo}`);
  if (proveedorId) conditions.push(Prisma.sql`p.id = ${proveedorId}`);
  if (observacionQuery) conditions.push(observacionCondition(t, observacionQuery));
  if (importeQuery) {
    const cond = importeCondition(t, importeQuery);
    if (cond) conditions.push(cond);
  }
  return conditions;
}
