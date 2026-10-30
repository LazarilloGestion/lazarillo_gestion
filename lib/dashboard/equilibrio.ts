// Punto de equilibrio (Diego 30/10/2026): cuánto hay que vender para no perder.
//
// Los gastos se separan en VARIABLES (acompañan a la venta; por defecto Mercaderías, Otros gastos,
// Impuesto fiscal y los Feriados del personal — tabla equilibrio_variables) y FIJOS (el resto).
//   % variable = variables / ventas
//   equilibrio = fijos / (1 − % variable)
// Con los números del mismo mes, lo que queda de lo vendido arriba del equilibrio
// ((ventas − equilibrio) × (1 − % variable)) es exactamente el resultado: así se lee
// de dónde sale la ganancia sin confundir "arriba del equilibrio" con ganancia.

export interface EquilibrioMes {
  ventas: number;
  egresos: number;
  variable: number;
  pctVariable: number; // 0..1
  fijos: number;
  equilibrio: number | null; // null si lo variable se come toda la venta
  diferencia: number; // ventas − equilibrio
  queda: number; // de cada peso vendido, lo que queda para los fijos (1 − % variable)
}

export function equilibrioMes(ventas: number, egresos: number, variable: number): EquilibrioMes | null {
  if (!(ventas > 0)) return null;
  const pctVariable = Math.max(0, variable) / ventas;
  const fijos = egresos - variable;
  const queda = 1 - pctVariable;
  const equilibrio = queda > 0.02 ? fijos / queda : null;
  return { ventas, egresos, variable, pctVariable, fijos, equilibrio, diferencia: equilibrio == null ? 0 : ventas - equilibrio, queda };
}

/** % variable de los últimos meses cerrados (ponderado por ventas): para proyectar el mes en curso. */
export function pctVariableReciente(meses: { ventas: number; variable: number }[]): number | null {
  const v = meses.filter((m) => m.ventas > 0);
  const ventas = v.reduce((s, m) => s + m.ventas, 0);
  return ventas > 0 ? v.reduce((s, m) => s + m.variable, 0) / ventas : null;
}

export interface EquilibrioProyectado extends EquilibrioMes {
  facturado: number;
  diasRestantes: number;
  falta: number; // lo que falta vender para llegar (0 si ya llegó)
  porDia: number | null; // falta / días restantes
}

/** Mes en curso: equilibrio con los egresos proyectados y el % variable de los meses cerrados. */
export function equilibrioProyectado(p: {
  ventasProy: number; egresosProy: number; pctVariable: number; facturado: number; diasRestantes: number;
}): EquilibrioProyectado | null {
  const base = equilibrioMes(p.ventasProy, p.egresosProy, p.pctVariable * p.ventasProy);
  if (!base) return null;
  const falta = base.equilibrio == null ? 0 : Math.max(0, base.equilibrio - p.facturado);
  return { ...base, facturado: p.facturado, diasRestantes: p.diasRestantes, falta, porDia: falta > 0 && p.diasRestantes > 0 ? falta / p.diasRestantes : null };
}
