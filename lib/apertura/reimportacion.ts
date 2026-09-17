import type { PrismaClient } from "@prisma/client";
import { revertirCompras, reaplicarReglasActivas } from "./motor";

export interface SincronizarTrasImportResultado {
  comprasRecalculadas: number;
  reglasReaplicadas: number;
  errores: string[];
  omitidas: string[];
}

// Corre al final de cada import de compras (app/api/etl/drive-import/route.ts,
// después de que TODOS los archivos del batch ya commitearon). Dos pasos, un
// solo camino de código para "compra corregida" y "compra nueva" (Fase D,
// diseño técnico sección 6):
//
// 1. Cada compra en `comprasModificadas` (ya distribuida, con algún campo ERP
//    cambiado — ver camposErpCambiaron en lib/etl/normalizers/compras-diff.ts)
//    se revierte: queda esDistribuido = false, disponible para el paso 2. Si
//    la regla que la cubre está inactiva, NO se revierte — desactivar
//    preserva el historial de distribuciones ya generadas (contrato del
//    endpoint, app/api/apertura/reglas/[id]/route.ts) y revertir acá lo
//    borraría en silencio pese a que el ERP cambió el dato. Se reporta en
//    `omitidas`, separado de `errores` (no es una falla, es la protección
//    funcionando — revisión final de rama, ronda 2, hallazgo Minor).
// 2. aplicarRegla se vuelve a correr para TODAS las reglas activas. Es
//    idempotente por diseño (solo toca compras con esDistribuido = false), así
//    que agarra en la misma pasada tanto las compras recién revertidas como
//    cualquier compra genuinamente nueva del batch que caiga en el período de
//    una regla activa — sin necesidad de rastrear qué conceptos tocó el
//    import (ver "por qué no filtrar por concepto tocado" en la sección 10.3
//    del diseño: con el volumen esperado de reglas activas, filtrar sería una
//    optimización prematura que acopla más el ETL a apertura).
//
// Cada compra revertida y cada regla reaplicada corre en su propia
// $transaction — un fallo puntual no aborta el resto del batch, se acumula en
// `errores` (nunca se traga en silencio, CLAUDE.md sección 2).
export async function sincronizarTrasImport(
  prisma: PrismaClient,
  comprasModificadas: string[]
): Promise<SincronizarTrasImportResultado> {
  const errores: string[] = [];
  const omitidas: string[] = [];
  let comprasRecalculadas = 0;

  if (comprasModificadas.length > 0) {
    // orderBy determinístico: hoy una compra pertenece a una sola regla a la
    // vez (aplicarRegla solo toma compras con esDistribuido = false), así que
    // en la práctica hay a lo sumo una fila por compra — el orderBy es una
    // salvaguarda barata contra ese invariante rompiéndose en el futuro sin
    // que el Map de abajo dependa de un orden arbitrario de Postgres.
    const distribuciones = await prisma.distribucionApertura.findMany({
      where: { compraRowId: { in: comprasModificadas } },
      orderBy: { id: "desc" },
      select: { compraRowId: true, regla: { select: { id: true, estado: true } } },
    });
    const distribucionPorRowId = new Map<string, (typeof distribuciones)[number]>();
    for (const d of distribuciones) {
      if (!distribucionPorRowId.has(d.compraRowId)) distribucionPorRowId.set(d.compraRowId, d);
    }

    const aRevertir: string[] = [];
    for (const rowId of comprasModificadas) {
      const distribucion = distribucionPorRowId.get(rowId);
      if (distribucion?.regla.estado === "inactiva") {
        omitidas.push(
          `revertirCompra(${rowId}): omitida — cubierta por la regla inactiva #${distribucion.regla.id}, se preserva el historial de distribución`
        );
        continue;
      }
      aRevertir.push(rowId);
    }

    if (aRevertir.length > 0) {
      try {
        // Un DELETE + un UPDATE batcheados para todo `aRevertir` (ver
        // revertirCompras en motor.ts) en vez de un findFirst + una
        // $transaction por rowId — se pierde aislamiento de fallos por compra
        // individual (revierte todo el lote o nada), a cambio de no pagar
        // cientos/miles de round trips secuenciales bajo el presupuesto de
        // maxDuration=60 (hallazgo de eficiencia, code-review 24-ago-2026).
        await prisma.$transaction(
          async (tx) => {
            await revertirCompras(tx, aRevertir);
          },
          { timeout: 15000 }
        );
        comprasRecalculadas = aRevertir.length;
      } catch (err) {
        errores.push(`revertirCompras(${aRevertir.length} compras): ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  const { reglasReaplicadas, errores: erroresReaplicar } = await reaplicarReglasActivas(prisma);
  errores.push(...erroresReaplicar);

  return { comprasRecalculadas, reglasReaplicadas, errores, omitidas };
}
