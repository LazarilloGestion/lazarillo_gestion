// Arma la serie mensual continua para Diferencia de caja y corre los dos cálculos derivados de ella:
// el valor "por mes" (principal, spec 2026-09-16) y el acumulado desde el primer arqueo (dato
// secundario de tooltip). Puro: sin fetch, sin Prisma, sin React — testeable con fixtures. La
// orquestación de datos (primer arqueo + sumas SQL) vive en app/api/dashboard/diferencia-caja/route.ts.

import { MONTH_IDXS } from "@/lib/dashboard/constants";
import {
  computeDiferenciaCajaAcumulada,
  computeDiferenciaCajaPorMes,
  type MesDatos,
} from "@/lib/dashboard/resultados-calc";

export interface TotalesAnio {
  ingresosPorMes: Record<number, number>;
  egresosPorMes: Record<number, number>;
  gananciaPorMes: Record<number, number>;
  disponiblePorMes: Record<number, number | null>;
}

export interface DiferenciaCajaMes {
  valor: number | null;      // "por mes" — lo que se muestra en la celda (spec 2026-09-16)
  acumulado: number | null;  // acumulado desde el primer arqueo — dato secundario de tooltip
}

// LÍMITE CONOCIDO (I-3, ver spec 2026-09-09 §1.5 y el fix wave del 24-ago-2026): los agregados
// de compras/ventas arman mapas dispersos — una clave de mes existe solo si hubo filas que
// matchearon. El `?? 0` no distingue "el mes tuvo $0 de verdad" de "no hay dato para este mes"
// (p. ej. import pendiente). Decisión pospuesta explícitamente (2026-09-09), documentada no resuelta.
function toSerieDeUnAnio(anio: number, totals: TotalesAnio): MesDatos[] {
  return MONTH_IDXS.map((mes) => ({
    anio,
    mes,
    ingresos: totals.ingresosPorMes[mes] ?? 0,
    egresos: totals.egresosPorMes[mes] ?? 0,
    ganancia: totals.gananciaPorMes[mes] ?? 0,
    disponible: totals.disponiblePorMes[mes] ?? null,
  }));
}

const ANIO_VACIO: TotalesAnio = {
  ingresosPorMes: {},
  egresosPorMes: {},
  gananciaPorMes: {},
  disponiblePorMes: {},
};

const MES_VACIO: DiferenciaCajaMes = { valor: null, acumulado: null };

export function buildDiferenciaCajaSerie(input: {
  year: number;
  primerArqueo: { anio: number; mes: number } | null;
  totalesPorAnio: Record<number, TotalesAnio>;
}): Record<number, DiferenciaCajaMes> {
  const { year, primerArqueo, totalesPorAnio } = input;

  const vacio: Record<number, DiferenciaCajaMes> = {};
  for (const mes of MONTH_IDXS) vacio[mes] = MES_VACIO;
  if (primerArqueo == null || primerArqueo.anio > year) return vacio;

  const anios: number[] = [];
  for (let a = primerArqueo.anio; a <= year; a++) anios.push(a);

  const serie: MesDatos[] = anios.flatMap((anio) =>
    toSerieDeUnAnio(anio, totalesPorAnio[anio] ?? ANIO_VACIO),
  );
  const porMes = computeDiferenciaCajaPorMes(serie, primerArqueo);
  const acumulado = computeDiferenciaCajaAcumulada(serie, primerArqueo);

  const offset = (year - primerArqueo.anio) * 12;
  const out: Record<number, DiferenciaCajaMes> = {};
  for (const mes of MONTH_IDXS) {
    const i = offset + (mes - 1);
    out[mes] = { valor: porMes[i] ?? null, acumulado: acumulado[i] ?? null };
  }
  return out;
}
