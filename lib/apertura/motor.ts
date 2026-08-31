import { Prisma, type PrismaClient } from "@prisma/client";
import { calcularDistribuciones, type DestinoPct } from "./calculo";
import { resolverVigencia, vigenciaToSql, type ReglaVigencia } from "./vigencia";
import { encontrarSuperposicion } from "./validaciones";

// Mismo shape que lib/etl/types.ts DbClient, redeclarado localmente para no
// acoplar lib/apertura/ (dominio de negocio) a lib/etl/ (dominio de import) —
// son capas sin relación, Ley de Deméter (CLAUDE.md sección 1). Compatible
// estructuralmente con Prisma.TransactionClient, así que aplicarRegla/
// revertirRegla funcionan igual pasadas directo o dentro de $transaction.
export type AperturaDbClient = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

// Filas de INSERT ... VALUES por flush — chunking por CANTIDAD DE FILAS, no de
// compras: cada compra emite una fila por destino, así que con muchos destinos
// por regla, contar por compra podía superar el límite de 65535 params de
// Postgres. Cada fila usa 6 params, así que 5000 filas ~= 30k params, bien por
// debajo del límite. (Fix de review, ronda 1 — ver task-6-report.md, hallazgo 2.)
const FLUSH_THRESHOLD = 5000;

interface AplicarReglaInput {
  reglaId: number;
  entidadId: string;
  vigencia: ReglaVigencia;
  destinos: DestinoPct[];
  origen: { origenLocalId: number | null; origenPuntoDeVentaId: number | null };
}

interface DestinoInput {
  localId: number | null;
  puntoDeVentaId: number | null;
  porcentaje: number;
}

// Un destino puede especificarse solo con puntoDeVentaId (el schema lo permite,
// spec sección 8 pide "selector local/PDV"). PuntoDeVenta.localId es NOT NULL,
// así que si falta localId lo resolvemos acá antes de persistir el destino —
// dejarlo NULL rompería cualquier lectura de pivot/detalle filtrada por local
// (hallazgo de la revisión final de rama de Fase B, 19-ago-2026).
export async function resolverLocalIdDestinos(
  prisma: AperturaDbClient,
  destinos: DestinoInput[]
): Promise<DestinoInput[]> {
  const idsAResolver = [
    ...new Set(
      destinos
        .filter((d) => d.localId == null && d.puntoDeVentaId != null)
        .map((d) => d.puntoDeVentaId!)
    ),
  ];
  if (idsAResolver.length === 0) return destinos;

  const pdvs = await prisma.puntoDeVenta.findMany({
    where: { id: { in: idsAResolver } },
    select: { id: true, localId: true },
  });
  const localIdPorPdv = new Map(pdvs.map((p) => [p.id, p.localId]));

  return destinos.map((d) =>
    d.localId == null && d.puntoDeVentaId != null
      ? { ...d, localId: localIdPorPdv.get(d.puntoDeVentaId) ?? null }
      : d
  );
}

// Igual que resolverLocalIdDestinos pero para el ORIGEN único de una regla:
// si vino solo puntoDeVentaId, completa el localId (PuntoDeVenta.localId es
// NOT NULL) antes de persistir — el filtro del motor y el índice usan
// origenLocalId para el caso "todo el local".
export async function resolverLocalIdOrigen(
  prisma: AperturaDbClient,
  origen: { origenLocalId: number | null; origenPuntoDeVentaId: number | null }
): Promise<{ origenLocalId: number | null; origenPuntoDeVentaId: number | null }> {
  if (origen.origenLocalId != null || origen.origenPuntoDeVentaId == null) return origen;
  const pdv = await prisma.puntoDeVenta.findUnique({
    where: { id: origen.origenPuntoDeVentaId },
    select: { localId: true },
  });
  return { ...origen, origenLocalId: pdv?.localId ?? null };
}

// Lanzado dentro del callback de $transaction cuando verificarSinSuperposicion
// detecta un conflicto — un return de NextResponse ahí adentro commitearía la
// transacción (sin haber hecho nada) y recién después devolvería el 409, lo
// cual es incorrecto. Throw + catch afuera fuerza el rollback correctamente.
// (Fix de review, ronda 1 — hallazgo TOCTOU en el chequeo de superposición.)
export class SuperposicionError extends Error {
  constructor(public reglaId: number) {
    super(`Superposición con la regla existente #${reglaId}`);
  }
}

// Chequeo de superposición DENTRO de la transacción — hacerlo antes de abrir
// la transacción permitía que dos requests concurrentes para el mismo
// entidadId con vigencias superpuestas pasaran ambos el chequeo (cada uno ve
// que el otro todavía no commiteó) y terminaran distribuyendo las mismas
// compras dos veces (fix de review, ronda 1). Compartido entre POST
// /api/apertura/reglas y PATCH /api/apertura/reglas/[id] — antes esta lógica
// (y la clase SuperposicionError) estaban copiadas verbatim en los dos route
// handlers (hallazgo de duplicación, code-review 24-ago-2026).
export async function verificarSinSuperposicion(
  prisma: AperturaDbClient,
  entidadId: string,
  vigenciaNueva: ReglaVigencia,
  excluirId?: number
): Promise<void> {
  const existentes = await prisma.reglaApertura.findMany({
    where: {
      entidadId,
      nivel: "concepto",
      estado: "activa",
      ...(excluirId != null ? { NOT: { id: excluirId } } : {}),
    },
    select: { id: true, modo: true, fechaDesde: true, fechaHasta: true, extremosInclusivos: true },
  });
  const conflictoId = encontrarSuperposicion(
    vigenciaNueva,
    existentes.map((r) => ({
      id: r.id,
      modo: r.modo as ReglaVigencia["modo"],
      fechaDesde: r.fechaDesde,
      fechaHasta: r.fechaHasta,
      extremosInclusivos: r.extremosInclusivos,
    }))
  );
  if (conflictoId !== null) {
    throw new SuperposicionError(conflictoId);
  }
}

// Condición WHERE + SELECT compartidos entre aplicarRegla (motor real) y el
// endpoint de preview de Fase C (GET /api/apertura/reglas/preview-total) —
// extraída para que ambos NUNCA puedan divergir en qué compras cuentan como
// "elegibles" (mismo concepto efectivo, no bloqueada, no distribuida, con
// importe efectivo, dentro de la vigencia). Devuelve el SELECT completo (no
// solo el WHERE) porque ambos callers necesitan las mismas columnas —
// aplicarRegla las usa fila por fila, preview-total las suma en un subquery.
//
// `reglaEnEdicionId` relaja el filtro esDistribuido para el preview del flujo
// de EDICIÓN: las compras que la propia regla ya distribuyó tienen
// esDistribuido = true, así que sin esta relajación el total previsualizado
// excluía justamente la plata de la que trata la regla (típicamente mostraba
// $0). aplicarRegla NO lo pasa a propósito: cuando corre durante una edición,
// revertirRegla ya borró las distribuciones viejas y reseteó esDistribuido,
// así que el filtro estricto es el correcto ahí.
export function condicionComprasElegibles(
  entidadId: string,
  vigenciaSql: Prisma.Sql,
  origen: { origenLocalId: number | null; origenPuntoDeVentaId: number | null },
  reglaEnEdicionId?: number | null
): Prisma.Sql {
  const filtroDistribuido =
    reglaEnEdicionId != null
      ? Prisma.sql`(c."esDistribuido" = false OR EXISTS (
          SELECT 1 FROM distribuciones_apertura da
          WHERE da."compraRowId" = c."rowId" AND da."reglaId" = ${reglaEnEdicionId}
        ))`
      : Prisma.sql`c."esDistribuido" = false`;

  // Origen: PDV puntual → solo ese PDV; solo local → todo el local. Una compra
  // sin localId/puntoDeVentaId nunca matchea (spec sección 4.1).
  const filtroOrigen =
    origen.origenPuntoDeVentaId != null
      ? Prisma.sql`c."puntoDeVentaId" = ${origen.origenPuntoDeVentaId}`
      : Prisma.sql`c."localId" = ${origen.origenLocalId}`;

  return Prisma.sql`
    SELECT c."rowId", COALESCE(c."importeManual", c.importe) AS "importeBase"
    FROM compras c
    WHERE COALESCE(c."conceptoCodigoManual", c."conceptoCodigo") = ${entidadId}
      AND c."esBloqueado" = false
      AND ${filtroDistribuido}
      AND ${filtroOrigen}
      AND COALESCE(c."importeManual", c.importe) IS NOT NULL
      AND (${vigenciaSql})
  `;
}

// Aplica una regla ya persistida: busca las compras vigentes de su concepto,
// calcula y persiste distribuciones_apertura, marca esDistribuido en las
// compras afectadas. Siempre sobre el importe EFECTIVO — ver Global
// Constraints (decisión de negocio 19-ago-2026).
//
// IMPORTANTE: debe llamarse SIEMPRE con un cliente de transacción
// (`prisma.$transaction(async (tx) => aplicarRegla(tx, ...))`), nunca con el
// `prisma` export a secas — una falla parcial fuera de una transacción deja
// filas en distribuciones_apertura sin el update de compras.esDistribuido
// aplicado (fix de review, ronda 1, hallazgo 5).
export async function aplicarRegla(
  prisma: AperturaDbClient,
  input: AplicarReglaInput
): Promise<{ comprasAfectadas: number }> {
  const cond = resolverVigencia(input.vigencia);
  const fechaEfectiva = Prisma.sql`COALESCE(c."fechaManual", c.fecha)`;
  const vigenciaSql = vigenciaToSql(cond, fechaEfectiva);

  const compras = await prisma.$queryRaw<{ rowId: string; importeBase: Prisma.Decimal }[]>(
    condicionComprasElegibles(input.entidadId, vigenciaSql, input.origen)
  );

  if (compras.length === 0) return { comprasAfectadas: 0 };

  const porcentajePorDestino = new Map(input.destinos.map((d) => [d.id, d.porcentaje]));

  let filas: Prisma.Sql[] = [];

  const flush = async () => {
    if (filas.length === 0) return;
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO distribuciones_apertura
        ("compraRowId", "reglaId", "destinoId", "importeOriginal", porcentaje, "importeCalculado")
      VALUES ${Prisma.join(filas)}
    `);
    filas = [];
  };

  for (const compra of compras) {
    // Number(x.toString()), no Number(x) directo — mismo patrón que
    // app/api/dashboard/pivot/route.ts (buildPivotData) ya usa para
    // convertir Prisma.Decimal a number de forma segura. Redondeo a 2
    // decimales inmediato: compras.importe es numeric sin precisión fija,
    // pero distribuciones_apertura es DECIMAL(14,2) — sin este redondeo,
    // calcularDistribuciones() trabajaría sobre el valor sin redondear
    // mientras Postgres redondea al insertar, rompiendo por una fracción de
    // centavo el invariante "suma de distribuciones = importe original,
    // exacto" (fix de review, ronda 1, hallazgo 7).
    const importeBase = Math.round(Number(compra.importeBase.toString()) * 100) / 100;
    const distribuciones = calcularDistribuciones(importeBase, input.destinos);
    for (const d of distribuciones) {
      filas.push(Prisma.sql`(
        ${compra.rowId}, ${input.reglaId}, ${d.destinoId},
        ${importeBase}::numeric, ${porcentajePorDestino.get(d.destinoId)}::numeric,
        ${d.importeCalculado}::numeric
      )`);
    }

    if (filas.length >= FLUSH_THRESHOLD) {
      await flush();
    }
  }

  await flush();

  const rowIds = compras.map((c) => c.rowId);
  await prisma.$executeRaw(Prisma.sql`
    UPDATE compras
    SET "esDistribuido" = true, "distribuidoEn" = now()
    WHERE "rowId" = ANY(${rowIds}::text[])
  `);

  return { comprasAfectadas: compras.length };
}

// Revierte todas las distribuciones de una regla: borra sus filas de
// distribuciones_apertura y recalcula esDistribuido en las compras afectadas
// según si les queda alguna OTRA distribución — más robusto que asumir que no
// puede quedarles ninguna (no depende de que el invariante de no-superposición
// se mantenga perfecto para todos los casos futuros, sección 7 del diseño).
//
// IMPORTANTE: al igual que aplicarRegla, debe llamarse SIEMPRE con un cliente
// de transacción — nunca con el `prisma` export a secas (fix de review,
// ronda 1, hallazgo 5).
export async function revertirRegla(prisma: AperturaDbClient, reglaId: number): Promise<{ comprasRevertidas: number }> {
  const afectadas = await prisma.$queryRaw<{ rowId: string }[]>(Prisma.sql`
    SELECT DISTINCT "compraRowId" AS "rowId" FROM distribuciones_apertura WHERE "reglaId" = ${reglaId}
  `);

  await prisma.$executeRaw(Prisma.sql`DELETE FROM distribuciones_apertura WHERE "reglaId" = ${reglaId}`);

  if (afectadas.length === 0) return { comprasRevertidas: 0 };

  const rowIds = afectadas.map((c) => c.rowId);
  await prisma.$executeRaw(Prisma.sql`
    UPDATE compras c
    SET
      "esDistribuido" = EXISTS (SELECT 1 FROM distribuciones_apertura da WHERE da."compraRowId" = c."rowId"),
      "distribuidoEn" = CASE
        WHEN EXISTS (SELECT 1 FROM distribuciones_apertura da WHERE da."compraRowId" = c."rowId") THEN c."distribuidoEn"
        ELSE NULL
      END
    WHERE c."rowId" = ANY(${rowIds}::text[])
  `);

  return { comprasRevertidas: afectadas.length };
}

// Revierte la distribución de UNA sola compra (no toda una regla): borra sus
// filas de distribuciones_apertura y la deja esDistribuido = false. Usada por
// sincronizarTrasImport (lib/apertura/reimportacion.ts) cuando una compra ya
// distribuida cambió en el ERP — revertir y dejar que la misma pasada de
// matching la vuelva a tomar es más simple que un recalculo dirigido, y es el
// mismo camino de código sin importar qué campo cambió (Fase D, diseño
// técnico sección 6).
//
// IMPORTANTE: igual que aplicarRegla/revertirRegla, debe llamarse SIEMPRE
// dentro de una $transaction — nunca con el `prisma` export a secas.
export async function revertirCompra(prisma: AperturaDbClient, rowId: string): Promise<void> {
  await prisma.$executeRaw(Prisma.sql`DELETE FROM distribuciones_apertura WHERE "compraRowId" = ${rowId}`);
  await prisma.$executeRaw(Prisma.sql`
    UPDATE compras SET "esDistribuido" = false, "distribuidoEn" = null WHERE "rowId" = ${rowId}
  `);
}

// Misma operación que revertirCompra, pero para muchas compras en 2 statements
// en vez de uno por rowId — usada por sincronizarTrasImport (reimportacion.ts)
// para no pagar N findFirst + N $transaction secuenciales por cada compra
// modificada del batch (riesgo de timeout con maxDuration=60, ver comentario
// de sincronizarTrasImport). Mismo patrón ANY($1) que ya usa revertirRegla.
export async function revertirCompras(prisma: AperturaDbClient, rowIds: string[]): Promise<void> {
  if (rowIds.length === 0) return;
  await prisma.$executeRaw(Prisma.sql`DELETE FROM distribuciones_apertura WHERE "compraRowId" = ANY(${rowIds}::text[])`);
  await prisma.$executeRaw(Prisma.sql`
    UPDATE compras SET "esDistribuido" = false, "distribuidoEn" = null WHERE "rowId" = ANY(${rowIds}::text[])
  `);
}
