import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { computeCompraRowId, compraIdentityFromRawRow } from "@/lib/etl/normalizers/compra-identity";
import { excelDateToISO } from "@/lib/etl/helpers";
import { filaDeRender } from "./filas";
import { leerTabla } from "./db";

// Compras que MaxiRest ya no tiene (Diego 28/10/2026, "cargada dos veces" de ARCA):
// cuando en MaxiRest se edita un gasto (importe de un ticket, concepto, observación, tipo de
// comprobante) cambia su identidad; el Panel traía la versión nueva y dejaba la vieja, así
// que el gasto quedaba contado dos veces (Bar jul–sep 2026: ~20 filas, $6,9 M).
//
// Render tiene la foto COMPLETA del 14 de cada PDV (año actual y anterior). Toda compra de
// MaxiRest (origen null) del Panel cuya identidad no está en esa foto es una versión vieja:
// se pone en $0 con la nota "MaxiRest ya no la tiene" (no se borra) y se guarda lo que tenía
// para devolverlo si la fila reaparece en MaxiRest.
//
// Cuidados: solo desde HUERFANAS_DESDE (antes, MaxiRest del Bar no tiene todo lo que trajo el
// Drive: sueldos de 2025 que no están) y nunca más del TOPE_MES de las filas de un mes (si
// faltara medio mes en Render sería un problema de la foto, no huérfanas): ese mes se saltea.

export const HUERFANAS_DESDE = "2026-01-01";
const TOPE_MES = 0.05;
const TOPE_MINIMO = 3;
// Primera versión: solo detecta (estado "propuesta") para revisar antes de tocar importes.
export const APLICAR_HUERFANAS = false;

export const NOTA_HUERFANA = "MaxiRest ya no la tiene";

type FilaPanel = { rowId: string; fecha: Date | null; importeManual: Prisma.Decimal | null; observacManual: string | null };

export type ResultadoHuerfanas = { marcadas: number; restauradas: number; mesesSalteados: string[] };

/** Identidades (rowId) de todo lo que tiene Render para el PDV, en sus tablas del 14. */
export async function rowIdsEnRender(esquema: string, tablas: string[], pdv: string): Promise<{ ids: Set<string>; porMes: Map<string, number> }> {
  const ids = new Set<string>();
  const porMes = new Map<string, number>();
  for (const tabla of tablas) {
    const { filas, tipos } = await leerTabla(esquema, tabla, pdv, false);
    for (const f of filas) {
      const r = filaDeRender(f, tipos);
      ids.add(computeCompraRowId(compraIdentityFromRawRow(r)));
      const iso = excelDateToISO(r["FECHA"]);
      if (iso) porMes.set(iso.slice(0, 7), (porMes.get(iso.slice(0, 7)) ?? 0) + 1);
    }
  }
  return { ids, porMes };
}

/** Elige qué filas del Panel son huérfanas, mes por mes, con el tope de seguridad. Puro. */
export function elegirHuerfanas(panel: { rowId: string; mes: string }[], enRender: Set<string>, desdeMes: string) {
  const porMes = new Map<string, { total: number; huerfanas: string[] }>();
  for (const p of panel) {
    if (p.mes < desdeMes) continue;
    const m = porMes.get(p.mes) ?? { total: 0, huerfanas: [] };
    m.total++;
    if (!enRender.has(p.rowId)) m.huerfanas.push(p.rowId);
    porMes.set(p.mes, m);
  }
  const elegidas: string[] = [];
  const salteados: string[] = [];
  for (const [mes, m] of [...porMes].sort()) {
    if (!m.huerfanas.length) continue;
    if (m.huerfanas.length > Math.max(TOPE_MINIMO, m.total * TOPE_MES)) { salteados.push(`${mes} (${m.huerfanas.length} de ${m.total})`); continue; }
    elegidas.push(...m.huerfanas);
  }
  return { elegidas, salteados };
}

export async function revisarHuerfanas(o: { esquema: string; pdv: string; puntoDeVentaId: number; tablas: string[] }): Promise<ResultadoHuerfanas> {
  const { ids } = await rowIdsEnRender(o.esquema, o.tablas, o.pdv);
  if (ids.size === 0) return { marcadas: 0, restauradas: 0, mesesSalteados: [] };

  // 1) Restaurar las que volvieron a aparecer en MaxiRest.
  const todas = await prisma.$queryRaw<{ rowId: string; estado: string; motivo: string; importeManualAntes: Prisma.Decimal | null; observacManualAntes: string | null }[]>`
    SELECT "rowId", estado, motivo, "importeManualAntes", "observacManualAntes" FROM compras_huerfanas
    WHERE "puntoDeVentaId" = ${o.puntoDeVentaId} AND estado IN ('propuesta', 'aplicada')`;
  // Solo se restauran solas las de este motivo (un duplicado anulado desde ARCA sigue en MaxiRest a propósito).
  const previas = todas.filter((x) => x.motivo === "maxirest_ya_no");
  let restauradas = 0;
  for (const p of previas.filter((x) => ids.has(x.rowId))) {
    await prisma.$transaction(async (tx) => {
      if (p.estado === "aplicada") {
        await tx.$executeRaw`UPDATE compras SET "importeManual" = ${p.importeManualAntes}, "observacManual" = ${p.observacManualAntes} WHERE "rowId" = ${p.rowId}`;
      }
      await tx.$executeRaw`UPDATE compras_huerfanas SET estado = 'restaurada', "actualizadaEn" = now() WHERE "rowId" = ${p.rowId}`;
    });
    restauradas++;
  }

  // 2) Las de MaxiRest que Render no tiene, desde HUERFANAS_DESDE.
  const panel = await prisma.$queryRaw<(FilaPanel & { mes: string })[]>`
    SELECT "rowId", fecha, "importeManual", "observacManual", to_char(fecha, 'YYYY-MM') AS mes
    FROM compras
    WHERE "puntoDeVentaId" = ${o.puntoDeVentaId} AND origen IS NULL AND fecha >= ${HUERFANAS_DESDE}::date`;
  // Ya hechas: las aplicadas (y, mientras solo se detecta, las propuestas).
  const yaMarcadas = new Set(todas.filter((x) => x.estado === "aplicada" || (!APLICAR_HUERFANAS && !ids.has(x.rowId))).map((x) => x.rowId));
  const { elegidas, salteados } = elegirHuerfanas(panel, ids, HUERFANAS_DESDE.slice(0, 7));
  const nuevas = elegidas.filter((id) => !yaMarcadas.has(id));
  const estado = APLICAR_HUERFANAS ? "aplicada" : "propuesta";
  for (const rowId of nuevas) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        INSERT INTO compras_huerfanas ("rowId", "puntoDeVentaId", fecha, comprobante, codigo, proveedor, concepto, importe,
                                       "importeManualAntes", "observacManualAntes", motivo, estado)
        SELECT "rowId", "puntoDeVentaId", fecha::date, comprobante, codigo, proveedor, concepto, importe,
               "importeManual", "observacManual", 'maxirest_ya_no', ${estado}
        FROM compras WHERE "rowId" = ${rowId}
        ON CONFLICT ("rowId") DO UPDATE SET estado = EXCLUDED.estado, "importeManualAntes" = EXCLUDED."importeManualAntes",
          "observacManualAntes" = EXCLUDED."observacManualAntes", "actualizadaEn" = now()
        WHERE compras_huerfanas.estado <> 'aplicada'`;
      if (APLICAR_HUERFANAS) {
        await tx.$executeRaw`
          UPDATE compras SET "importeManual" = 0,
            "observacManual" = ${NOTA_HUERFANA} || COALESCE(' · ' || COALESCE("observacManual", observac), '')
          WHERE "rowId" = ${rowId}`;
      }
    });
  }
  if (salteados.length) console.warn("[huerfanas] meses salteados", o.pdv, salteados);
  return { marcadas: nuevas.length, restauradas, mesesSalteados: salteados };
}
