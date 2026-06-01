import { Prisma } from "@prisma/client";

export function buildDateRange(year: number, mes?: number): { fechaStart: Date; fechaEnd: Date } {
  const fechaStart = mes ? new Date(Date.UTC(year, mes - 1, 1)) : new Date(Date.UTC(year, 0, 1));
  const fechaEnd   = mes ? new Date(Date.UTC(year, mes, 1))     : new Date(Date.UTC(year + 1, 0, 1));
  return { fechaStart, fechaEnd };
}

interface PivotConditionParams {
  year: number;
  tableAlias: string;
  localId?: number;
  pdvId?: number;
  months?: number[];
  rubroCodigo?: string;
  conceptoCodigo?: string;
  proveedorId?: number;
}

export function buildPivotConditions({
  year,
  tableAlias: t,
  localId,
  pdvId,
  months,
  rubroCodigo,
  conceptoCodigo,
  proveedorId,
}: PivotConditionParams): Prisma.Sql[] {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`EXTRACT(YEAR FROM ${Prisma.raw(t)}.fecha) = ${year}`,
    Prisma.sql`${Prisma.raw(t)}.fecha IS NOT NULL`,
    Prisma.sql`${Prisma.raw(t)}.importe IS NOT NULL`,
  ];
  if (localId) conditions.push(Prisma.sql`${Prisma.raw(t)}."localId" = ${localId}`);
  if (pdvId) conditions.push(Prisma.sql`${Prisma.raw(t)}."puntoDeVentaId" = ${pdvId}`);
  if (months?.length) {
    conditions.push(
      Prisma.sql`EXTRACT(MONTH FROM ${Prisma.raw(t)}.fecha)::int IN (${Prisma.join(months.map((m) => Prisma.sql`${m}`))})`
    );
  }
  if (rubroCodigo) conditions.push(Prisma.sql`COALESCE(rc.codigo, '__sin_rubro') = ${rubroCodigo}`);
  if (conceptoCodigo) conditions.push(Prisma.sql`COALESCE(cc.codigo, '__sin_concepto') = ${conceptoCodigo}`);
  if (proveedorId) conditions.push(Prisma.sql`p.id = ${proveedorId}`);
  return conditions;
}
