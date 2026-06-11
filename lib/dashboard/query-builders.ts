import { Prisma } from "@prisma/client";

export function buildDateRange(year: number, mes?: number): { fechaStart: Date; fechaEnd: Date } {
  const fechaStart = mes ? new Date(Date.UTC(year, mes - 1, 1)) : new Date(Date.UTC(year, 0, 1));
  const fechaEnd   = mes ? new Date(Date.UTC(year, mes, 1))     : new Date(Date.UTC(year + 1, 0, 1));
  return { fechaStart, fechaEnd };
}

interface PivotConditionParams {
  year: number;
  tableAlias: string;
  hasFechaManual?: boolean;
  hasImporteManual?: boolean;
  localId?: number;
  pdvId?: number;
  months?: number[];
  rubroCodigo?: string;
  conceptoCodigo?: string;
  proveedorId?: number;
  filterRubrosOcultos?: boolean;
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
  filterRubrosOcultos = false,
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
    Prisma.sql`EXTRACT(YEAR FROM ${fechaExpr}) = ${year}`,
    dateGuard,
    Prisma.sql`${Prisma.raw(t)}.importe IS NOT NULL`,
    Prisma.sql`${importeExpr} != 0`,
  ];
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
    conditions.push(Prisma.sql`(rc."visibleEnDashboard" = true OR rc.codigo IS NULL)`);
  }
  if (conceptoCodigo) conditions.push(Prisma.sql`COALESCE(cc.codigo, '__sin_concepto') = ${conceptoCodigo}`);
  if (proveedorId) conditions.push(Prisma.sql`p.id = ${proveedorId}`);
  return conditions;
}
