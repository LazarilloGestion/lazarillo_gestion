// Tarjetas del Panel general (rediseño aprobado por Diego, 30/10/2026, mockup_panel_v2c): el
// Panel sirve para mirar el ÚLTIMO MES CERRADO y anticipar el que corre (solo como proyección).
import { indicadores, type RubroMonto } from "@/lib/movil/indicadores";
import { equilibrioMes, type EquilibrioMes } from "@/lib/dashboard/equilibrio";

export interface MesDatos { mes: number; ventas: number; rubros: RubroMonto[] }

/**
 * Último mes cerrado del año que se mira: en el año en curso, el anterior al de hoy; en un año
 * pasado, diciembre. Si ese mes no tiene ventas, el último anterior que sí.
 */
export function mesCerrado(meses: MesDatos[], anio: number, hoy: { anio: number; mes: number }): number | null {
  const tope = anio < hoy.anio ? 12 : anio === hoy.anio ? hoy.mes - 1 : 0;
  for (let m = tope; m >= 1; m--) if ((meses.find((x) => x.mes === m)?.ventas ?? 0) > 0) return m;
  return null;
}

export interface TarjetasMes {
  mes: number;
  ventas: number;
  gastos: number;
  resultado: number;
  rentabilidad: number | null;
  foodCost: number | null;
  personal: number | null;
  mix: number | null;
  ventasVsAnterior: number | null; // variación % contra el mes anterior (0,05 = +5%)
  difFoodCost: number | null;      // puntos contra el mes anterior
  difPersonal: number | null;
  difMix: number | null;
  equilibrio: EquilibrioMes | null;
}

export function tarjetasDelMes(meses: MesDatos[], mes: number, variable: number | null, anterior?: MesDatos | null): TarjetasMes | null {
  const m = meses.find((x) => x.mes === mes);
  if (!m || !(m.ventas > 0)) return null;
  const i = indicadores(m.ventas, m.rubros);
  const ant = anterior ?? meses.find((x) => x.mes === mes - 1) ?? null;
  const ia = ant && ant.ventas > 0 ? indicadores(ant.ventas, ant.rubros) : null;
  const pp = (a: number | null, b: number | null | undefined) => (a == null || b == null ? null : (a - b) * 100);
  return {
    mes, ventas: i.ventas, gastos: i.gastos, resultado: i.resultado, rentabilidad: i.rentabilidad,
    foodCost: i.foodCost, personal: i.personal, mix: i.mix,
    ventasVsAnterior: ia && ia.ventas > 0 ? i.ventas / ia.ventas - 1 : null,
    difFoodCost: pp(i.foodCost, ia?.foodCost), difPersonal: pp(i.personal, ia?.personal), difMix: pp(i.mix, ia?.mix),
    equilibrio: variable == null ? null : equilibrioMes(i.ventas, i.gastos, variable),
  };
}

export interface Alerta { texto: string; nivel: "rojo" | "ambar" }

/**
 * Alertas de "Para mirar": un indicador del mes cerrado que se fue de lo normal (más de 2 puntos
 * arriba del promedio de los 6 meses anteriores con ventas) y no haber llegado al equilibrio.
 */
export function alertasDelMes(meses: MesDatos[], t: TarjetasMes, anteriores: MesDatos[] = []): Alerta[] {
  const previos = [...anteriores, ...meses.filter((m) => m.mes < t.mes)].filter((m) => m.ventas > 0).slice(-6);
  const out: Alerta[] = [];
  if (t.equilibrio?.equilibrio != null && t.equilibrio.diferencia < 0) out.push({ texto: "No llegó al equilibrio", nivel: "rojo" });
  if (previos.length >= 3) {
    const prom = (k: "foodCost" | "personal") => {
      const xs = previos.map((m) => indicadores(m.ventas, m.rubros)[k]).filter((v): v is number => v != null);
      return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
    };
    for (const [k, nombre] of [["foodCost", "Food cost"], ["personal", "Personal"]] as const) {
      const p = prom(k), v = t[k];
      if (p != null && v != null && (v - p) * 100 > 2) {
        out.push({ texto: `${nombre} ${(v * 100).toLocaleString("es-AR", { maximumFractionDigits: 1 })}% · ${((v - p) * 100).toLocaleString("es-AR", { maximumFractionDigits: 1 })} pp arriba de lo normal`, nivel: "ambar" });
      }
    }
  }
  return out;
}
