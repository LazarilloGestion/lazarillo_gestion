import type { PrismaClient } from "@prisma/client";
import { aplicarRegla, revertirCompra } from "./motor";
import type { ReglaVigencia } from "./vigencia";

export interface SincronizarTrasImportResultado {
  comprasRecalculadas: number;
  reglasReaplicadas: number;
  errores: string[];
}

// Corre al final de cada import de compras (app/api/etl/drive-import/route.ts,
// después de que TODOS los archivos del batch ya commitearon). Dos pasos, un
// solo camino de código para "compra corregida" y "compra nueva" (Fase D,
// diseño técnico sección 6):
//
// 1. Cada compra en `comprasModificadas` (ya distribuida, con algún campo ERP
//    cambiado — ver camposErpCambiaron en lib/etl/normalizers/compras-diff.ts)
//    se revierte: queda esDistribuido = false, disponible para el paso 2.
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
  let comprasRecalculadas = 0;

  for (const rowId of comprasModificadas) {
    try {
      const distribucion = await prisma.distribucionApertura.findFirst({
        where: { compraRowId: rowId },
        select: { regla: { select: { id: true, estado: true } } },
      });

      if (distribucion?.regla.estado === "inactiva") {
        // No revertir: la regla que cubre esta compra está desactivada, y
        // desactivar preserva el historial de distribuciones ya generadas
        // (contrato del endpoint, ver app/api/apertura/reglas/[id]/route.ts).
        // Revertir acá borraría ese historial en silencio pese a que el ERP
        // cambió el dato — se reporta en vez de tocar nada (Fase D, revisión
        // final de rama, hallazgo Critical C1).
        errores.push(
          `revertirCompra(${rowId}): omitida — cubierta por la regla inactiva #${distribucion.regla.id}, se preserva el historial de distribución`
        );
        continue;
      }

      await prisma.$transaction(async (tx) => {
        await revertirCompra(tx, rowId);
      });
      comprasRecalculadas++;
    } catch (err) {
      errores.push(`revertirCompra(${rowId}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const reglasActivas = await prisma.reglaApertura.findMany({
    where: { estado: "activa" },
    include: { destinos: true },
  });

  let reglasReaplicadas = 0;
  for (const regla of reglasActivas) {
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
            entidadId: regla.entidadId,
            vigencia,
            destinos: regla.destinos.map((d) => ({ id: d.id, porcentaje: Number(d.porcentaje.toString()) })),
          });
        },
        // 15s, no 55s: esta transacción corre dentro de un loop de N reglas
        // activas, adentro de una función con maxDuration=60 que ya gastó
        // tiempo en ETL antes de llegar acá — 55s por regla podía exceder el
        // presupuesto total con más de una regla activa (revisión final de
        // rama, hallazgo Important I2). Si en la práctica una regla real
        // necesita más de 15s (ej. "histórico completo" sobre un volumen muy
        // grande), revisitar — no se sobre-diseña con presupuesto dinámico
        // para un caso hipotético ahora (mismo criterio YAGNI que la sección
        // 5 del diseño técnico usa para maxDuration en general).
        { timeout: 15000 }
      );
      reglasReaplicadas++;
    } catch (err) {
      errores.push(`aplicarRegla(regla #${regla.id}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { comprasRecalculadas, reglasReaplicadas, errores };
}
