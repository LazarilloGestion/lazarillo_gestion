// Indicadores del Inicio del celu (Diego 28/10/2026): food cost (mercadería / ventas),
// personal (gastos en personal / ventas), mix (los dos) y rentabilidad (resultado / ventas),
// el cambio en puntos contra el mes anterior y el promedio mensual de los meses cerrados.

export interface RubroMonto { rubro: string; total: number }
export interface Indicadores { ventas: number; gastos: number; resultado: number; rentabilidad: number | null; foodCost: number | null; personal: number | null; mix: number | null }

const suma = (rs: RubroMonto[], re: RegExp) => rs.filter((r) => re.test(r.rubro)).reduce((s, r) => s + r.total, 0);

export function indicadores(ventas: number, rubros: RubroMonto[]): Indicadores {
  const gastos = rubros.reduce((s, r) => s + r.total, 0);
  const pct = (x: number) => (ventas > 0 ? x / ventas : null);
  const merc = suma(rubros, /mercader/i);
  const pers = suma(rubros, /personal/i);
  return { ventas, gastos, resultado: ventas - gastos, rentabilidad: pct(ventas - gastos), foodCost: pct(merc), personal: pct(pers), mix: pct(merc + pers) };
}

/** Diferencia en puntos porcentuales (0.023 → 2,3 pp). null si falta alguno. */
export function difPp(actual: number | null, anterior: number | null): number | null {
  return actual == null || anterior == null ? null : (actual - anterior) * 100;
}

/** Promedio mensual de los meses con ventas, sumando todo (los % salen de los totales). */
export function promedioMensual(meses: { ventas: number; rubros: RubroMonto[] }[]) {
  const con = meses.filter((m) => m.ventas > 0);
  if (!con.length) return null;
  const rubros = new Map<string, number>();
  for (const m of con) for (const r of m.rubros) rubros.set(r.rubro, (rubros.get(r.rubro) ?? 0) + r.total);
  const ventas = con.reduce((s, m) => s + m.ventas, 0);
  const tot = indicadores(ventas, [...rubros].map(([rubro, total]) => ({ rubro, total })));
  return { ...tot, meses: con.length, ventas: tot.ventas / con.length, gastos: tot.gastos / con.length, resultado: tot.resultado / con.length };
}
