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
        { timeout: 55000 }
      );
      reglasReaplicadas++;
    } catch (err) {
      errores.push(`aplicarRegla(regla #${regla.id}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { comprasRecalculadas, reglasReaplicadas, errores };
}
