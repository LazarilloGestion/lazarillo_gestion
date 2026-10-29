import { Prisma } from "@prisma/client";
import { prisma as prismaDefault } from "@/lib/prisma";
import { resolverVigencia, vigenciaToSql, FECHA_EFECTIVA_COMPRA_SQL, type ReglaVigencia } from "@/lib/apertura/vigencia";
import { parsearEntidadIdProveedorTexto } from "@/lib/proveedor-entidad-id";
import { reevaluarCompra } from "@/lib/apertura/reevaluacion";
import type { ReglaConceptoEmpleado } from "./concepto-fijo";

// Aplica el concepto fijo de cada empleado a sus compras (ver concepto-fijo.ts). Idempotente: se
// corre al guardar o quitar una regla y después de cada import. Escribe conceptoCodigoManual y
// marca conceptoPorRegla con el id de la regla, para:
//   - no pisar nunca un concepto que corrigió una persona (conceptoPorRegla NULL con manual);
//   - poder deshacerlo cuando la regla se quita o el registro sale de su período.
// Si a un registro le cambia el concepto y tiene (o tendría) apertura por concepto, se reevalúa.

type Db = typeof prismaDefault;

export async function reglasActivas(db: Db, pdvId?: number): Promise<ReglaConceptoEmpleado[]> {
  const filas = await db.$queryRaw<(Omit<ReglaConceptoEmpleado, "fechaDesde" | "fechaHasta"> & { fechaDesde: Date | null; fechaHasta: Date | null })[]>`
    SELECT id, "entidadId", nombre, "origenPuntoDeVentaId", "conceptoCodigo", modo, "fechaDesde", "fechaHasta", "extremosInclusivos"
    FROM reglas_concepto_empleado WHERE estado = 'activa' ${pdvId ? Prisma.sql`AND "origenPuntoDeVentaId" = ${pdvId}` : Prisma.empty}
    ORDER BY id`;
  return filas.map((r) => ({ ...r, fechaDesde: r.fechaDesde?.toISOString() ?? null, fechaHasta: r.fechaHasta?.toISOString() ?? null }));
}

/** Condición SQL (alias c = compras) de "esta compra es del empleado de la regla y cae en su período". */
export function condicionRegla(r: Pick<ReglaConceptoEmpleado, "entidadId" | "origenPuntoDeVentaId" | "modo" | "fechaDesde" | "fechaHasta" | "extremosInclusivos">): Prisma.Sql | null {
  const ent = parsearEntidadIdProveedorTexto(r.entidadId);
  if (!ent) return null;
  const v: ReglaVigencia = { modo: r.modo, fechaDesde: r.fechaDesde ? new Date(r.fechaDesde) : null, fechaHasta: r.fechaHasta ? new Date(r.fechaHasta) : null, extremosInclusivos: r.extremosInclusivos };
  return Prisma.sql`c."proveedorId" IS NULL AND c."puntoDeVentaId" = ${r.origenPuntoDeVentaId}
    AND c."proveedorTextoNormalizado" = ${ent.normalizado}
    ${ent.codigo != null ? Prisma.sql`AND c.codigo = ${ent.codigo}` : Prisma.empty}
    AND ${vigenciaToSql(resolverVigencia(v), FECHA_EFECTIVA_COMPRA_SQL)}`;
}

/** Qué cambiaría una regla (sin tocar nada): registros, total y conceptos de origen. */
export async function previsualizar(db: Db, r: Parameters<typeof condicionRegla>[0] & { conceptoCodigo: string; id?: number }) {
  const cond = condicionRegla(r);
  if (!cond) return { registros: 0, total: 0, conceptos: [] as { concepto: string; n: number; total: number }[] };
  const filas = await db.$queryRaw<{ concepto: string; n: number; total: number }[]>`
    SELECT COALESCE(cc.nombre, COALESCE(c."conceptoCodigoManual", c."conceptoCodigo"), 'Sin concepto') AS concepto,
           COUNT(*)::int AS n, SUM(COALESCE(c."importeManual", c.importe))::float8 AS total
    FROM compras c LEFT JOIN conceptos_caja cc ON cc.codigo = COALESCE(c."conceptoCodigoManual", c."conceptoCodigo")
    WHERE ${cond}
      AND (c."conceptoCodigoManual" IS NULL OR c."conceptoPorRegla" IS NOT NULL)
      AND COALESCE(c."conceptoCodigoManual", c."conceptoCodigo", '') <> ${r.conceptoCodigo}
    GROUP BY 1 ORDER BY 3 DESC`;
  return { registros: filas.reduce((s, f) => s + f.n, 0), total: filas.reduce((s, f) => s + f.total, 0), conceptos: filas };
}

/** Aplica todas las reglas activas (de un PDV o de todos). Devuelve cuántos registros cambió. */
export async function aplicarConceptosEmpleado(db: Db = prismaDefault, opts: { pdvId?: number } = {}): Promise<{ cambiados: number; reevaluados: number; errores: string[] }> {
  const reglas = await reglasActivas(db, opts.pdvId);
  const cambiados = new Set<string>();
  const errores: string[] = [];
  const pdvFiltro = opts.pdvId ? Prisma.sql`AND c."puntoDeVentaId" = ${opts.pdvId}` : Prisma.empty;

  // 1) Deshacer lo que puso una regla que ya no está activa.
  const ids = reglas.map((r) => r.id);
  const sueltos = await db.$queryRaw<{ rowId: string }[]>`
    UPDATE compras c SET "conceptoCodigoManual" = NULL, "conceptoPorRegla" = NULL
    WHERE c."conceptoPorRegla" IS NOT NULL ${pdvFiltro}
      ${ids.length ? Prisma.sql`AND c."conceptoPorRegla" NOT IN (${Prisma.join(ids)})` : Prisma.empty}
    RETURNING c."rowId"`;
  sueltos.forEach((f) => cambiados.add(f.rowId));

  for (const r of reglas) {
    const cond = condicionRegla(r);
    if (!cond) { errores.push(`Regla ${r.id}: empleado sin identificar (${r.entidadId})`); continue; }
    // 2) Deshacer los que puso esta regla y ya no le corresponden (cambió el período).
    const fuera = await db.$queryRaw<{ rowId: string }[]>`
      UPDATE compras c SET "conceptoCodigoManual" = NULL, "conceptoPorRegla" = NULL
      WHERE c."conceptoPorRegla" = ${r.id} AND NOT (${cond})
      RETURNING c."rowId"`;
    fuera.forEach((f) => cambiados.add(f.rowId));
    // 3) Aplicar a los suyos, salvo los corregidos a mano por una persona.
    const dentro = await db.$queryRaw<{ rowId: string }[]>`
      UPDATE compras c SET "conceptoCodigoManual" = ${r.conceptoCodigo}, "conceptoPorRegla" = ${r.id}
      WHERE ${cond}
        AND (c."conceptoCodigoManual" IS NULL OR c."conceptoPorRegla" IS NOT NULL)
        AND (c."conceptoPorRegla" IS DISTINCT FROM ${r.id} OR c."conceptoCodigoManual" IS DISTINCT FROM ${r.conceptoCodigo})
      RETURNING c."rowId"`;
    dentro.forEach((f) => cambiados.add(f.rowId));
  }

  // 4) Apertura: los que cambiaron de concepto y están (o quedarían) repartidos por una regla de
  //    nivel concepto se reevalúan. Las de nivel empleado/registro no dependen del concepto.
  let reevaluados = 0;
  if (cambiados.size) {
    const lista = [...cambiados];
    const areevaluar = await db.$queryRaw<{ rowId: string }[]>`
      SELECT c."rowId" FROM compras c
      WHERE c."rowId" IN (${Prisma.join(lista)})
        AND (EXISTS (SELECT 1 FROM distribuciones_apertura da JOIN reglas_apertura ra ON ra.id = da."reglaId"
                     WHERE da."compraRowId" = c."rowId" AND ra.nivel = 'concepto')
          OR EXISTS (SELECT 1 FROM reglas_apertura ra WHERE ra.estado = 'activa' AND ra.nivel = 'concepto'
                     AND ra."entidadId" = COALESCE(c."conceptoCodigoManual", c."conceptoCodigo")))`;
    for (const { rowId } of areevaluar.slice(0, 300)) {
      try {
        await db.$transaction((tx) => reevaluarCompra(tx as never, rowId), { timeout: 20_000 });
        reevaluados++;
      } catch (e) {
        errores.push(`Apertura ${rowId}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (areevaluar.length > 300) errores.push(`Quedaron ${areevaluar.length - 300} registros sin reevaluar la apertura.`);
  }
  return { cambiados: cambiados.size, reevaluados, errores };
}
