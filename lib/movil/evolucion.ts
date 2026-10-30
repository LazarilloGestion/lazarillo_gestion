import { indicadores, type RubroMonto } from "./indicadores";

// Evolución de un indicador del celu (Diego 29/10/2026): al tocar Food cost / Personal / Mix, los
// últimos N meses hasta el que se mira, con la diferencia en puntos contra el mes anterior.
export type ClaveIndicador = "foodCost" | "personal" | "mix";
export interface MesAnual { anio: number; mes: number; ventas: number; rubros: RubroMonto[] }
export interface PuntoEvolucion { anio: number; mes: number; valor: number | null; dif: number | null; proyectado: boolean }

export function serieIndicador(p: {
  meses: MesAnual[];
  clave: ClaveIndicador;
  hasta: { anio: number; mes: number };
  n: number;
  // El mes que se mira, si se muestra proyectado / con lo sin cargar (el mismo valor que la tarjeta).
  actual?: { valor: number | null; proyectado: boolean } | null;
}): PuntoEvolucion[] {
  const t0 = p.hasta.anio * 12 + p.hasta.mes - 1;
  const valorDe = (anio: number, mes: number): number | null => {
    if (anio === p.hasta.anio && mes === p.hasta.mes && p.actual) return p.actual.valor;
    const m = p.meses.find((x) => x.anio === anio && x.mes === mes);
    return m && m.ventas > 0 ? indicadores(m.ventas, m.rubros)[p.clave] : null;
  };
  const out: PuntoEvolucion[] = [];
  // Uno más al principio para tener la diferencia del primero.
  for (let k = p.n; k >= 0; k--) {
    const t = t0 - k;
    const anio = Math.floor(t / 12), mes = (t % 12) + 1;
    const valor = valorDe(anio, mes);
    const ant = out.length ? out[out.length - 1].valor : null;
    out.push({ anio, mes, valor, dif: valor != null && ant != null ? (valor - ant) * 100 : null, proyectado: k === 0 && !!p.actual?.proyectado });
  }
  return out.slice(1);
}
