import { indicadores, type RubroMonto } from "./indicadores";

// Evolución de un indicador del celu (Diego 29/10/2026): al tocar una tarjeta del Inicio, los
// últimos N meses hasta el que se mira, con la diferencia contra el mes anterior.
// Food cost / Personal / Mix / Rentabilidad son % (diferencia en puntos); Ventas / Gastos /
// Resultado son plata (diferencia en % contra el mes anterior).
export type ClaveIndicador = "foodCost" | "personal" | "mix" | "ventas" | "gastos" | "resultado" | "rentabilidad";
export interface MesAnual { anio: number; mes: number; ventas: number; rubros: RubroMonto[] }
export interface PuntoEvolucion { anio: number; mes: number; valor: number | null; dif: number | null; proyectado: boolean }

export const INFO_INDICADOR: Record<ClaveIndicador, { titulo: string; tipo: "pct" | "plata"; mejor: "sube" | "baja" }> = {
  ventas:       { titulo: "Ventas",       tipo: "plata", mejor: "sube" },
  gastos:       { titulo: "Gastos",       tipo: "plata", mejor: "baja" },
  resultado:    { titulo: "Resultado",    tipo: "plata", mejor: "sube" },
  rentabilidad: { titulo: "Rentabilidad", tipo: "pct",   mejor: "sube" },
  foodCost:     { titulo: "Food cost",    tipo: "pct",   mejor: "baja" },
  personal:     { titulo: "Personal",     tipo: "pct",   mejor: "baja" },
  mix:          { titulo: "Mix",          tipo: "pct",   mejor: "baja" },
};

/** Diferencia contra el anterior: puntos (0.32 vs 0.30 → 2) para %, variación % para plata. */
export function difContra(clave: ClaveIndicador, valor: number | null, ant: number | null): number | null {
  if (valor == null || ant == null) return null;
  if (INFO_INDICADOR[clave].tipo === "pct") return (valor - ant) * 100;
  return ant === 0 ? null : ((valor - ant) / Math.abs(ant)) * 100;
}

/** "bueno" / "malo" / null (sin cambio) según hacia dónde conviene que vaya el indicador. */
export function sentido(clave: ClaveIndicador, dif: number | null): "bueno" | "malo" | null {
  if (dif == null || Math.abs(dif) < 0.05) return null;
  return (dif > 0) === (INFO_INDICADOR[clave].mejor === "sube") ? "bueno" : "malo";
}

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
    out.push({ anio, mes, valor, dif: difContra(p.clave, valor, ant), proyectado: k === 0 && !!p.actual?.proyectado });
  }
  return out.slice(1);
}
