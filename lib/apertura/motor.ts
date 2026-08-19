import { Prisma, type PrismaClient } from "@prisma/client";
import { calcularDistribuciones, type DestinoPct } from "./calculo";
import { resolverVigencia, vigenciaToSql, type ReglaVigencia } from "./vigencia";

// Mismo shape que lib/etl/types.ts DbClient, redeclarado localmente para no
// acoplar lib/apertura/ (dominio de negocio) a lib/etl/ (dominio de import) —
// son capas sin relación, Ley de Deméter (CLAUDE.md sección 1). Compatible
// estructuralmente con Prisma.TransactionClient, así que aplicarRegla/
// revertirRegla funcionan igual pasadas directo o dentro de $transaction.
export type AperturaDbClient = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

// Compras por chunk de INSERT ... VALUES — mismo criterio que
// lib/etl/normalizers/compras.ts (CHUNK_SIZE=500, ~9k params/chunk con la
// forma actual de la tabla, bien por debajo del límite de 65535 de Postgres).
const CHUNK_SIZE = 500;

interface AplicarReglaInput {
  reglaId: number;
  entidadId: string;
  vigencia: ReglaVigencia;
  destinos: DestinoPct[];
}

// Aplica una regla ya persistida: busca las compras vigentes de su concepto,
// calcula y persiste distribuciones_apertura, marca esDistribuido en las
// compras afectadas. Siempre sobre el importe EFECTIVO — ver Global
// Constraints (decisión de negocio 19-ago-2026).
export async function aplicarRegla(
  prisma: AperturaDbClient,
  input: AplicarReglaInput
): Promise<{ comprasAfectadas: number }> {
  const cond = resolverVigencia(input.vigencia);
  const fechaEfectiva = Prisma.sql`COALESCE(c."fechaManual", c.fecha)`;
  const vigenciaSql = vigenciaToSql(cond, fechaEfectiva);

  const compras = await prisma.$queryRaw<{ rowId: string; importeBase: Prisma.Decimal }[]>(Prisma.sql`
    SELECT c."rowId", COALESCE(c."importeManual", c.importe) AS "importeBase"
    FROM compras c
    WHERE COALESCE(c."conceptoCodigoManual", c."conceptoCodigo") = ${input.entidadId}
      AND c."esBloqueado" = false
      AND c.importe IS NOT NULL
      AND ${vigenciaSql}
  `);

  if (compras.length === 0) return { comprasAfectadas: 0 };

  const porcentajePorDestino = new Map(input.destinos.map((d) => [d.id, d.porcentaje]));

  for (let i = 0; i < compras.length; i += CHUNK_SIZE) {
    const chunk = compras.slice(i, i + CHUNK_SIZE);
    const filas: Prisma.Sql[] = [];

    for (const compra of chunk) {
      // Number(x.toString()), no Number(x) directo — mismo patrón que
      // app/api/dashboard/pivot/route.ts (buildPivotData) ya usa para
      // convertir Prisma.Decimal a number de forma segura.
      const importeBase = Number(compra.importeBase.toString());
      const distribuciones = calcularDistribuciones(importeBase, input.destinos);
      for (const d of distribuciones) {
        filas.push(Prisma.sql`(
          ${compra.rowId}, ${input.reglaId}, ${d.destinoId},
          ${importeBase}::numeric, ${porcentajePorDestino.get(d.destinoId)}::numeric,
          ${d.importeCalculado}::numeric
        )`);
      }
    }

    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO distribuciones_apertura
        ("compraRowId", "reglaId", "destinoId", "importeOriginal", porcentaje, "importeCalculado")
      VALUES ${Prisma.join(filas)}
    `);
  }

  await prisma.$executeRaw(Prisma.sql`
    UPDATE compras
    SET "esDistribuido" = true, "distribuidoEn" = now()
    WHERE "rowId" IN (${Prisma.join(compras.map((c) => c.rowId))})
  `);

  return { comprasAfectadas: compras.length };
}

// Revierte todas las distribuciones de una regla: borra sus filas de
// distribuciones_apertura y recalcula esDistribuido en las compras afectadas
// según si les queda alguna OTRA distribución — más robusto que asumir que no
// puede quedarles ninguna (no depende de que el invariante de no-superposición
// se mantenga perfecto para todos los casos futuros, sección 7 del diseño).
export async function revertirRegla(prisma: AperturaDbClient, reglaId: number): Promise<{ comprasRevertidas: number }> {
  const afectadas = await prisma.$queryRaw<{ rowId: string }[]>(Prisma.sql`
    SELECT DISTINCT "compraRowId" AS "rowId" FROM distribuciones_apertura WHERE "reglaId" = ${reglaId}
  `);

  await prisma.$executeRaw(Prisma.sql`DELETE FROM distribuciones_apertura WHERE "reglaId" = ${reglaId}`);

  if (afectadas.length === 0) return { comprasRevertidas: 0 };

  await prisma.$executeRaw(Prisma.sql`
    UPDATE compras c
    SET
      "esDistribuido" = EXISTS (SELECT 1 FROM distribuciones_apertura da WHERE da."compraRowId" = c."rowId"),
      "distribuidoEn" = CASE
        WHEN EXISTS (SELECT 1 FROM distribuciones_apertura da WHERE da."compraRowId" = c."rowId") THEN c."distribuidoEn"
        ELSE NULL
      END
    WHERE c."rowId" IN (${Prisma.join(afectadas.map((c) => c.rowId))})
  `);

  return { comprasRevertidas: afectadas.length };
}
