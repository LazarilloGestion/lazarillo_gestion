import { Prisma } from "@prisma/client";
import { buildDateRange, observacionCondition, sinRubroVisibleSql } from "./query-builders";

export interface DetalleConditionParams {
  year: number;
  localId?: number;
  pdvId?: number;
  mes?: number;
  // Selección parcial de meses — se ignora si viene `mes`.
  meses?: number[];
  proveedorId?: number;
  proveedorTexto?: string;
  codigo?: string;
  sinProveedor: boolean;
  rubroCodigo?: string;
  conceptoCodigo?: string;
  observacionQuery?: string;
}

// WHERE de la lista de /api/dashboard/detalle. Extraído de la ruta para poder testearlo: el modal
// tiene que traer exactamente las compras que suma la celda clickeada del pivot, así que cada
// predicado replica el de buildPivotConditions. Alias que asume: c (v_compras_distribuidas),
// p (proveedores), rc_ef (rubro del concepto efectivo).
export function buildDetalleConditions({
  year, localId, pdvId, mes, meses, proveedorId, proveedorTexto, codigo, sinProveedor,
  rubroCodigo, conceptoCodigo, observacionQuery,
}: DetalleConditionParams): Prisma.Sql[] {
  const { fechaStart, fechaEnd } = buildDateRange(year, mes);

  const conditions: Prisma.Sql[] = [
    Prisma.sql`COALESCE(c."fechaManual", c.fecha) >= ${fechaStart} AND COALESCE(c."fechaManual", c.fecha) < ${fechaEnd}`,
    Prisma.sql`(c.fecha IS NOT NULL OR c."fechaManual" IS NOT NULL)`,
    Prisma.sql`COALESCE(c."importeManual", c.importe) IS NOT NULL AND COALESCE(c."importeManual", c.importe) != 0`,
  ];
  if (!mes && meses?.length) {
    conditions.push(Prisma.sql`EXTRACT(MONTH FROM COALESCE(c."fechaManual", c.fecha))::int IN (${Prisma.join(meses)})`);
  }
  if (localId !== undefined) conditions.push(Prisma.sql`c."localId" = ${localId}`);
  if (pdvId !== undefined) conditions.push(Prisma.sql`c."puntoDeVentaId" = ${pdvId}`);
  if (proveedorId !== undefined) conditions.push(Prisma.sql`p.id = ${proveedorId}`);
  else if (proveedorTexto !== undefined) {
    // codigo es un AND adicional, no un reemplazo de proveedorTexto — dos
    // personas con el mismo proveedorTexto (ej. dos "Abril") solo se separan
    // si también se filtra por su código real (ver spec de la revisión final
    // de rama). Sin codigo en la URL (compatibilidad con proveedores de texto
    // crudo sin código), el filtro queda igual que antes.
    conditions.push(
      codigo !== undefined
        ? Prisma.sql`c."proveedorId" IS NULL AND c.proveedor = ${proveedorTexto} AND c.codigo = ${codigo}`
        : Prisma.sql`c."proveedorId" IS NULL AND c.proveedor = ${proveedorTexto}`
    );
  }
  else if (sinProveedor) conditions.push(Prisma.sql`c."proveedorId" IS NULL AND c.proveedor IS NULL`);

  // cc_ef/rc_ef (concepto EFECTIVO, mismo join que pivot usa: COALESCE(manual,
  // original)) es solo para filtrar. Filtrar por el concepto NO-coalescido
  // sería un bug: una compra reclasificada a mano a otro rubro/concepto
  // dejaría de aparecer al filtrar por su rubro nuevo, o seguiría apareciendo
  // en el rubro viejo.
  if (rubroCodigo && !conceptoCodigo) {
    // Mismo criterio que el pivot (query-builders.ts) y el SELECT de
    // /api/dashboard/pivot: el bucket "Sin Rubro" es sintético
    // ('__sin_rubro'), no existe como código real en rubros_concepto_caja.
    // Sin el COALESCE, rc_ef.codigo es NULL para esas compras y
    // `NULL = '__sin_rubro'` nunca matchea — el modal abre vacío.
    conditions.push(Prisma.sql`COALESCE(rc_ef.codigo, '__sin_rubro') = ${rubroCodigo}`);
  } else if (conceptoCodigo) {
    conditions.push(Prisma.sql`COALESCE(c."conceptoCodigoManual", c."conceptoCodigo") = ${conceptoCodigo}`);
  } else {
    // Sin filtro de rubro/concepto: excluir rubros ocultos con el rubro
    // EFECTIVO, igual que buildPivotConditions. Antes se usaba el concepto
    // original: una compra reclasificada a mano entre un rubro visible y uno
    // oculto hacía que la suma del modal no coincidiera con el total del pie
    // (spec 2026-10-08-totales-mes-anio-gastos).
    conditions.push(
      Prisma.sql`(rc_ef."visibleEnDashboard" = true OR (rc_ef.codigo IS NULL AND ${sinRubroVisibleSql("visibleEnDashboard")}))`
    );
  }

  if (observacionQuery) conditions.push(observacionCondition("c", observacionQuery));

  return conditions;
}
