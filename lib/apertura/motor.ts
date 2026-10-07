import { Prisma, type PrismaClient } from "@prisma/client";
import { calcularDistribuciones, type DestinoPct } from "./calculo";
import { resolverVigencia, vigenciaToSql, FECHA_EFECTIVA_COMPRA_SQL, type ReglaVigencia } from "./vigencia";
import { encontrarSuperposicion, origenesSuperpuestos } from "./validaciones";
import type { NivelRegla } from "./schemas";
import { parsearEntidadIdProveedorTexto } from "../proveedor-entidad-id";
import { seleccionarReglasCandidatas, type CompraLiberada } from "./cascada";

// Orden fijo de prioridad cuando una compra matchea reglas de más de un
// nivel — spec v2 sección 2, no negociable. Número más alto = gana.
export const PRIORIDAD_NIVEL: Record<NivelRegla, number> = {
  registro: 3,
  proveedor: 2,
  concepto: 1,
};

// Predicado de matching por nivel — hasta Fase 2 estaba hardcodeado a
// concepto dentro de condicionComprasElegibles. proveedorId es Int en
// compras, entidadId siempre es String — el cast ::text deja que un
// proveedorId null nunca matchee (null::text = cualquier cosa es null,
// osea false), igual que hoy pasa con conceptoCodigo ausente.
//
// nivel: NivelRegla (no string) a propósito — un typo en un futuro caller
// antes caía silenciosamente en el branch de concepto de abajo y distribuía
// plata real contra las compras equivocadas sin ningún error (hallazgo de la
// revisión final de rama). Con el tipo acotado al enum de nivelReglaSchema,
// un valor no reconocido es un error de compilación, no un bug de datos.
export function condicionMatchNivel(nivel: NivelRegla, entidadId: string): Prisma.Sql {
  if (nivel === "proveedor") {
    // "texto:" identifica una regla sobre un proveedor de texto crudo del ERP
    // (Diego, GASTOS VARIOS, o el nodo genuino "Sin Proveedor" → "texto:sinproveedor")
    // en vez de un proveedorId real — mismo prefijo que ya usa provKeyOriginal en
    // lib/dashboard/pivot-por-proveedor.ts, para que agrupación visual y matching
    // de reglas nunca diverjan. proveedorTextoNormalizado (lib/etl/normalizers/
    // compras.ts) solo se calcula cuando proveedorId es null, así que el AND es
    // necesario: sin él, una compra con proveedorId real cuyo proveedorTextoNormalizado
    // quedó de un import viejo (no aplica hoy, pero no depende de esa garantía)
    // podría matchear por error.
    const parsed = parsearEntidadIdProveedorTexto(entidadId);
    if (parsed !== null) {
      // "|codigo:" separa el nombre normalizado del código real de la compra —
      // dos personas con el mismo nombre pero código distinto (ej. dos "Abril")
      // no deben matchear la misma regla. Se compara contra la columna cruda
      // Compra.codigo (no un campo materializado) a propósito: evita tocar
      // proveedorTextoNormalizado, que ya está poblado para todo el histórico.
      // Ver docs/superpowers/specs/2026-09-28-codigo-empleado-proveedor-design.md §3.6.
      // Paréntesis envolventes: los callers de hoy solo concatenan con AND, pero
      // uno futuro que use OR/NOT rompería la precedencia en silencio sobre plata
      // real (el IS NULL se ataría al OR externo en vez de al igual de texto).
      return parsed.codigo !== null
        ? Prisma.sql`(c."proveedorId" IS NULL AND c."proveedorTextoNormalizado" = ${parsed.normalizado} AND c."codigo" = ${parsed.codigo})`
        : Prisma.sql`(c."proveedorId" IS NULL AND c."proveedorTextoNormalizado" = ${parsed.normalizado})`;
    }
    return Prisma.sql`c."proveedorId"::text = ${entidadId}`;
  }
  // OJO: rowId no es estable para compras SIN comprobante confiable (sueldos,
  // alquiler, gastos sueltos, tickets) — computeCompraRowId (lib/etl/normalizers/
  // compra-identity.ts) incluye el importe en el hash para esos casos, así que
  // una reimportación que corrige el monto genera un rowId NUEVO y una regla de
  // registro existente queda apuntando a uno huérfano, sin matchear nada, sin
  // ningún aviso. No alcanzable hoy (no hay reglas de registro en producción,
  // ninguna UI las crea) — pendiente de resolver antes de que exista esa UI:
  // ¿re-clavar la regla al nuevo rowId? ¿avisar al usuario? ¿no permitir
  // registro sobre compras sin comprobante confiable?
  if (nivel === "registro") return Prisma.sql`c."rowId" = ${entidadId}`;
  return Prisma.sql`COALESCE(c."conceptoCodigoManual", c."conceptoCodigo") = ${entidadId}`;
}

// Mismo shape que lib/etl/types.ts DbClient, redeclarado localmente para no
// acoplar lib/apertura/ (dominio de negocio) a lib/etl/ (dominio de import) —
// son capas sin relación, Ley de Deméter (CLAUDE.md sección 1). Compatible
// estructuralmente con Prisma.TransactionClient, así que aplicarRegla/
// revertirRegla funcionan igual pasadas directo o dentro de $transaction.
export type AperturaDbClient = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

// Clave del advisory lock que serializa TODAS las corridas que distribuyen
// compras (aplicarRegla, reevaluarCompra). Número fijo y arbitrario, solo tiene
// que ser el mismo en cada caller y no chocar con otro uso de advisory locks
// (hoy no hay ninguno en el repo).
const APERTURA_LOCK_KEY = 7281001;

// Serializa las corridas del motor: sin esto, dos corridas concurrentes (dos
// imports de Drive solapados, dos pestañas, un reintento tras timeout) leen las
// MISMAS compras con esDistribuido = false (READ COMMITTED, sin lock de fila) e
// insertan cada una su copia — y distribuciones_apertura no tiene UNIQUE que lo
// frene. Pasó dos veces en producción (28-sep y 3-oct-2026): 1.569 compras de
// Ramos Mejía con el importe ×2/×3.
//
// Es un lock de TRANSACCIÓN (xact): se suelta solo al commit/rollback, así que
// no hay nada que liberar a mano ni riesgo de dejarlo colgado si algo falla. La
// segunda corrida espera a que la primera commitee y recién ahí lee, ya con
// esDistribuido = true. Debe llamarse ANTES de la primera lectura de la
// corrida, y siempre dentro de una $transaction (mismo contrato que
// aplicarRegla). Si la espera supera el timeout de la transacción, esa corrida
// falla con error visible (no en silencio) y se reintenta sola en el próximo
// sync.
export async function tomarLockDeAplicacion(prisma: AperturaDbClient): Promise<void> {
  await prisma.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(${APERTURA_LOCK_KEY}::bigint)`);
}

// Filas de INSERT ... VALUES por flush — chunking por CANTIDAD DE FILAS, no de
// compras: cada compra emite una fila por destino, así que con muchos destinos
// por regla, contar por compra podía superar el límite de 65535 params de
// Postgres. Cada fila usa 6 params, así que 5000 filas ~= 30k params, bien por
// debajo del límite. (Fix de review, ronda 1 — ver task-6-report.md, hallazgo 2.)
const FLUSH_THRESHOLD = 5000;

interface AplicarReglaInput {
  reglaId: number;
  nivel: NivelRegla;
  entidadId: string;
  vigencia: ReglaVigencia;
  destinos: DestinoPct[];
  origen: { origenLocalId: number | null; origenPuntoDeVentaId: number | null };
  soloRowIds?: string[];
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
  nivel: NivelRegla,
  entidadId: string,
  vigenciaNueva: ReglaVigencia,
  origenNuevo: { localId: number | null; puntoDeVentaId: number | null },
  excluirId?: number
): Promise<void> {
  const existentes = await prisma.reglaApertura.findMany({
    where: {
      entidadId,
      nivel,
      estado: "activa",
      ...(excluirId != null ? { NOT: { id: excluirId } } : {}),
    },
    select: {
      id: true, modo: true, fechaDesde: true, fechaHasta: true, extremosInclusivos: true,
      origenLocalId: true, origenPuntoDeVentaId: true,
    },
  });

  // Solo chocan las reglas cuyo ORIGEN compite por la misma plata que el
  // nuevo — dos reglas del mismo concepto para PDV distintos pueden coexistir
  // con fechas solapadas (spec sección 5).
  const conOrigenSolapado = existentes.filter((r) =>
    origenesSuperpuestos(
      { localId: origenNuevo.localId, puntoDeVentaId: origenNuevo.puntoDeVentaId },
      { localId: r.origenLocalId, puntoDeVentaId: r.origenPuntoDeVentaId }
    )
  );

  const conflictoId = encontrarSuperposicion(
    vigenciaNueva,
    conOrigenSolapado.map((r) => ({
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
// aplicarRegla las usa fila por fila, preview-total las agrupa por mes en un
// subquery. fechaEfectiva viaja en el SELECT (no solo en el WHERE via
// vigenciaSql) porque preview-total la necesita para el GROUP BY; aplicarRegla
// simplemente la ignora.
//
// `reglaEnEdicionId` relaja el filtro esDistribuido para el preview del flujo
// de EDICIÓN: las compras que la propia regla ya distribuyó tienen
// esDistribuido = true, así que sin esta relajación el total previsualizado
// excluía justamente la plata de la que trata la regla (típicamente mostraba
// $0). aplicarRegla NO lo pasa a propósito: cuando corre durante una edición,
// revertirRegla ya borró las distribuciones viejas y reseteó esDistribuido,
// así que el filtro estricto es el correcto ahí.
export function condicionComprasElegibles(
  nivel: NivelRegla,
  entidadId: string,
  vigenciaSql: Prisma.Sql,
  origen: { origenLocalId: number | null; origenPuntoDeVentaId: number | null },
  reglaEnEdicionId?: number | null,
  // Acota la búsqueda a estas compras — lo usa la cascada tras eliminar/editar
  // una regla, que solo necesita reevaluar las compras recién liberadas.
  soloRowIds?: string[]
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

  const filtroRowIds = soloRowIds != null ? Prisma.sql`AND c."rowId" = ANY(${soloRowIds}::text[])` : Prisma.empty;

  return Prisma.sql`
    SELECT c."rowId", COALESCE(c."importeManual", c.importe) AS "importeBase", ${FECHA_EFECTIVA_COMPRA_SQL} AS "fechaEfectiva"
    FROM compras c
    WHERE ${condicionMatchNivel(nivel, entidadId)}
      AND c."esBloqueado" = false
      AND ${filtroDistribuido}
      AND ${filtroOrigen}
      AND COALESCE(c."importeManual", c.importe) IS NOT NULL
      AND (${vigenciaSql})
      ${filtroRowIds}
  `;
}

// Antes de que una regla de mayor prioridad reclame compras, hay que ceder
// las que ya estaban tomadas por una regla de MENOR prioridad — aplicarRegla
// nunca las hubiera tocado por su cuenta (su WHERE exige esDistribuido =
// false). No hace nada si `nivel` es la prioridad más baja (concepto): no hay
// nada de dónde ceder, y el comportamiento de v1 queda intacto.
//
// También cede compras que hoy están bajo una regla de menor prioridad
// DESACTIVADA — eso borra el historial de distribuciones que "desactivar"
// normalmente preserva (ver PATCH /api/apertura/reglas/[id]). Es intencional,
// confirmado con el usuario: la alternativa (no tocar reglas desactivadas)
// dejaría esas compras bloqueadas para siempre y la regla nueva se aplicaría
// solo parcialmente a su conjunto de compras, sin ningún aviso — peor que
// perder un historial ya inerte.
export async function liberarComprasReclamables(
  prisma: AperturaDbClient,
  nivel: NivelRegla,
  entidadId: string,
  vigenciaSql: Prisma.Sql,
  origen: { origenLocalId: number | null; origenPuntoDeVentaId: number | null }
): Promise<void> {
  const prioridadNueva = PRIORIDAD_NIVEL[nivel];
  const nivelesMenores = Object.entries(PRIORIDAD_NIVEL)
    .filter(([, p]) => p < prioridadNueva)
    .map(([n]) => n);
  if (nivelesMenores.length === 0) return;

  const filtroOrigen =
    origen.origenPuntoDeVentaId != null
      ? Prisma.sql`c."puntoDeVentaId" = ${origen.origenPuntoDeVentaId}`
      : Prisma.sql`c."localId" = ${origen.origenLocalId}`;

  const filas = await prisma.$queryRaw<{ rowId: string }[]>(Prisma.sql`
    SELECT DISTINCT c."rowId"
    FROM compras c
    JOIN distribuciones_apertura da ON da."compraRowId" = c."rowId"
    JOIN reglas_apertura ra          ON ra.id = da."reglaId"
    WHERE ${condicionMatchNivel(nivel, entidadId)}
      AND c."esBloqueado" = false
      AND ${filtroOrigen}
      AND COALESCE(c."importeManual", c.importe) IS NOT NULL
      AND (${vigenciaSql})
      AND ra.nivel = ANY(${nivelesMenores}::text[])
  `);

  if (filas.length > 0) await revertirCompras(prisma, filas.map((f) => f.rowId));
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
  await tomarLockDeAplicacion(prisma);

  const cond = resolverVigencia(input.vigencia);
  const vigenciaSql = vigenciaToSql(cond, FECHA_EFECTIVA_COMPRA_SQL);

  const compras = await prisma.$queryRaw<{ rowId: string; importeBase: Prisma.Decimal }[]>(
    condicionComprasElegibles(input.nivel, input.entidadId, vigenciaSql, input.origen, null, input.soloRowIds)
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

// Distribuye UNA sola compra según una regla ya resuelta — hermano acotado de
// aplicarRegla, usado por reevaluarCompra (lib/apertura/reevaluacion.ts) tras
// una edición manual. No corre el WHERE de condicionComprasElegibles: el
// caller ya decidió que esta compra concreta cae en la regla. Siempre dentro
// de $transaction (igual que el resto del motor).
export async function aplicarReglaACompra(
  prisma: AperturaDbClient,
  input: { reglaId: number; rowId: string; importeBase: number; destinos: DestinoPct[] }
): Promise<void> {
  // Sin destinos no hay nada que distribuir y `Prisma.join([])` tiraría — mismo
  // guard que el hermano aplicarRegla hace con `filas.length === 0`. Solo
  // alcanzable con una regla malformada, pero es defensa barata.
  if (input.destinos.length === 0) return;

  const importeBase = Math.round(input.importeBase * 100) / 100;
  const distribuciones = calcularDistribuciones(importeBase, input.destinos);
  const porcentajePorDestino = new Map(input.destinos.map((d) => [d.id, d.porcentaje]));

  const filas = distribuciones.map(
    (d) => Prisma.sql`(
      ${input.rowId}, ${input.reglaId}, ${d.destinoId},
      ${importeBase}::numeric, ${porcentajePorDestino.get(d.destinoId)}::numeric,
      ${d.importeCalculado}::numeric
    )`
  );

  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO distribuciones_apertura
      ("compraRowId", "reglaId", "destinoId", "importeOriginal", porcentaje, "importeCalculado")
    VALUES ${Prisma.join(filas)}
  `);
  await prisma.$executeRaw(Prisma.sql`
    UPDATE compras SET "esDistribuido" = true, "distribuidoEn" = now() WHERE "rowId" = ${input.rowId}
  `);
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
export async function revertirRegla(
  prisma: AperturaDbClient,
  reglaId: number
): Promise<{ comprasRevertidas: number; rowIds: string[] }> {
  const afectadas = await prisma.$queryRaw<{ rowId: string }[]>(Prisma.sql`
    SELECT DISTINCT "compraRowId" AS "rowId" FROM distribuciones_apertura WHERE "reglaId" = ${reglaId}
  `);

  await prisma.$executeRaw(Prisma.sql`DELETE FROM distribuciones_apertura WHERE "reglaId" = ${reglaId}`);

  if (afectadas.length === 0) return { comprasRevertidas: 0, rowIds: [] };

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

  return { comprasRevertidas: afectadas.length, rowIds };
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

// Comparador de prioridad extraído para poder testearlo aislado (motor.test.ts)
// sin levantar Prisma — la única pieza pura de este archivo hasta ahora.
export function compararPrioridadNivel(a: { nivel: NivelRegla }, b: { nivel: NivelRegla }): number {
  return PRIORIDAD_NIVEL[b.nivel] - PRIORIDAD_NIVEL[a.nivel];
}

// Vuelve a aplicar TODAS las reglas activas, en orden de prioridad
// (registro primero, concepto último) — el orden importa porque
// aplicarRegla reclama greedily lo primero que encuentra sin distribuir
// todavía: si una regla de concepto corriera antes que una de proveedor
// sobre la misma compra recién liberada, se la quedaría igual aunque la de
// proveedor tenga más prioridad. Usada por sincronizarTrasImport
// (reimportacion.ts) y por el cascadeo tras eliminar una regla (ver DELETE
// /api/apertura/reglas/[id]).
//
// Verificado contra datos reales de producción: una compra migró
// correctamente concepto → proveedor → registro → proveedor → concepto,
// mismo importe distribuido en cada paso (17-sep-2026).
//
// Con `opciones.rowIds` (cascada tras eliminar/editar UNA regla) reevalúa solo
// esas compras recién liberadas, y solo con las reglas que pueden reclamarlas:
// reaplicar las ~200 reglas activas por cada borrado tardaba más que el
// maxDuration de la request y fallaba a mitad de camino. Asume el invariante de
// que, fuera de lo recién liberado, ninguna compra elegible queda sin
// distribuir — la reimportación (sin rowIds) sigue reaplicando todo y lo sana.
export async function reaplicarReglasActivas(
  prisma: PrismaClient,
  opciones: { rowIds?: string[] } = {}
): Promise<{ reglasReaplicadas: number; errores: string[] }> {
  const soloRowIds = opciones.rowIds;
  if (soloRowIds !== undefined && soloRowIds.length === 0) return { reglasReaplicadas: 0, errores: [] };

  const todasActivas = await prisma.reglaApertura.findMany({
    where: { estado: "activa" },
    include: { destinos: true },
  });
  // Con la reimportación (sin rowIds) también se acota: ~200 reglas, cada una en
  // su propia transacción con lock, no entran en los 60 s de maxDuration del
  // finalizar del import — las del final (compras nuevas de Bar, 3-oct-2026)
  // quedaban sin abrir y sin ningún aviso.
  const reglasActivas = seleccionarReglasCandidatas(
    todasActivas.map((r) => ({ ...r, nivel: r.nivel as NivelRegla })),
    soloRowIds === undefined
      ? await cargarComprasSinDistribuir(prisma, todasActivas)
      : await cargarComprasLiberadas(prisma, soloRowIds)
  );

  // la columna DB no tiene enum — nivelReglaSchema ya validó el valor cuando se
  // creó cada regla. Se castea una sola vez acá para que tanto el sort de abajo
  // (compararPrioridadNivel espera NivelRegla) como el resto del loop trabajen
  // con el tipo acotado sin repetir el cast en cada uso.
  const conNivelTipado = reglasActivas.map((r) => ({ ...r, nivel: r.nivel as NivelRegla }));

  // Dentro del mismo nivel no hace falta orderBy adicional: verificarSinSuperposicion
  // ya impide que dos reglas activas del mismo nivel con el mismo entidadId compitan
  // por la misma compra, y dos reglas del mismo nivel con entidadId distinto nunca
  // pueden matchear la misma compra (una compra tiene un solo concepto, un solo
  // proveedor, un solo rowId) — el orden dentro de un nivel es inobservable.
  const ordenadas = [...conNivelTipado].sort(compararPrioridadNivel);

  const errores: string[] = [];
  let reglasReaplicadas = 0;

  for (const regla of ordenadas) {
    try {
      await prisma.$transaction(
        async (tx) => {
          const vigencia: ReglaVigencia = {
            modo: regla.modo as ReglaVigencia["modo"],
            fechaDesde: regla.fechaDesde,
            fechaHasta: regla.fechaHasta,
            extremosInclusivos: regla.extremosInclusivos,
          };
          await aplicarRegla(tx, {
            reglaId: regla.id,
            nivel: regla.nivel,
            entidadId: regla.entidadId,
            vigencia,
            origen: { origenLocalId: regla.origenLocalId, origenPuntoDeVentaId: regla.origenPuntoDeVentaId },
            destinos: regla.destinos.map((d) => ({ id: d.id, porcentaje: Number(d.porcentaje.toString()) })),
            soloRowIds,
          });
        },
        // 15s, no 55s: esta función puede correr dentro de un caller con
        // maxDuration=60 que ya gastó tiempo antes de llegar acá (reimportación) o
        // que además tiene su propia transacción de 55s corrida justo antes (DELETE
        // de una regla) — 55s por regla podía exceder el presupuesto total con más
        // de una regla activa. Si en la práctica una regla real necesita más de
        // 15s (ej. "histórico completo" sobre un volumen muy grande), revisitar —
        // no se sobre-diseña con presupuesto dinámico para un caso hipotético
        // ahora (mismo criterio YAGNI de siempre en este módulo).
        { timeout: 15000 }
      );
      reglasReaplicadas++;
    } catch (err) {
      errores.push(`aplicarRegla(regla #${regla.id}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { reglasReaplicadas, errores };
}

// Claves de matching de TODAS las compras sin distribuir, para el prefiltro de la
// reimportación. Hay decenas de miles (la mayoría no tiene regla), así que se
// agrupa por las claves de matching en vez de traer una fila por compra; el
// rowId (MIN) es solo de relleno — las reglas de nivel registro, las únicas que
// matchean por rowId, se resuelven con una segunda query acotada a sus entidadId.
async function cargarComprasSinDistribuir(
  prisma: PrismaClient,
  reglasActivas: { nivel: string; entidadId: string }[]
): Promise<CompraLiberada[]> {
  const porClaves = await prisma.$queryRaw<CompraLiberada[]>(Prisma.sql`
    SELECT MIN(c."rowId") AS "rowId",
           COALESCE(c."conceptoCodigoManual", c."conceptoCodigo") AS "conceptoEfectivo",
           c."proveedorId", c."proveedorTextoNormalizado", c."codigo"
    FROM compras c
    WHERE c."esDistribuido" = false AND c."esBloqueado" = false
    GROUP BY 2, 3, 4, 5
  `);

  const rowIdsRegistro = reglasActivas.filter((r) => r.nivel === "registro").map((r) => r.entidadId);
  if (rowIdsRegistro.length === 0) return porClaves;

  const registros = await prisma.$queryRaw<CompraLiberada[]>(Prisma.sql`
    SELECT c."rowId",
           COALESCE(c."conceptoCodigoManual", c."conceptoCodigo") AS "conceptoEfectivo",
           c."proveedorId", c."proveedorTextoNormalizado", c."codigo"
    FROM compras c
    WHERE c."esDistribuido" = false AND c."esBloqueado" = false
      AND c."rowId" = ANY(${rowIdsRegistro}::text[])
  `);
  return [...porClaves, ...registros];
}

// Claves de matching de las compras liberadas — mismas columnas (y mismo
// COALESCE de concepto) que condicionMatchNivel, para que el prefiltro de
// seleccionarReglasCandidatas nunca diverja de la query que decide de verdad.
async function cargarComprasLiberadas(prisma: PrismaClient, rowIds: string[]): Promise<CompraLiberada[]> {
  return prisma.$queryRaw<CompraLiberada[]>(Prisma.sql`
    SELECT c."rowId",
           COALESCE(c."conceptoCodigoManual", c."conceptoCodigo") AS "conceptoEfectivo",
           c."proveedorId", c."proveedorTextoNormalizado", c."codigo"
    FROM compras c
    WHERE c."rowId" = ANY(${rowIds}::text[])
  `);
}
