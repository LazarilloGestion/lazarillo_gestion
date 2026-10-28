// Gastos al cierre del mes en curso, por rubro (celu, Diego 28/10/2026: "vengo en 85 M de
// gastos y la proyección da 73 M"). Lo cargado + lo que falta cargar (Sin carga) no alcanza:
// hay gastos variables que no son "de todos los meses" y la mercadería entra con atraso.
//   - Mercaderías: el food cost promedio de los meses cerrados × las ventas proyectadas.
//   - Cada otro rubro: su promedio de los meses cerrados.
// En los dos casos nunca menos que lo cargado + lo que falta cargar (si ya se gastó más, manda eso).

export interface RubroMonto { rubro: string; total: number }
export interface MesCerrado { ventas: number; rubros: RubroMonto[] }
export interface RubroProyectado { rubro: string; total: number; cargado: number; sinCargar: number; variable: number }

const norm = (t: string) => t.trim().toLowerCase();
const esMercaderia = (r: string) => /mercader/i.test(r);

export function proyectarGastos(p: {
  cargado: RubroMonto[];
  sinCargar: { rubro: string; ultimo: number }[];
  historia: MesCerrado[];
  ventasProy: number;
}) {
  const m = new Map<string, RubroProyectado>();
  const de = (rubro: string) => {
    const k = norm(rubro);
    let r = m.get(k);
    if (!r) { r = { rubro: rubro.trim(), total: 0, cargado: 0, sinCargar: 0, variable: 0 }; m.set(k, r); }
    return r;
  };
  for (const c of p.cargado) de(c.rubro).cargado += c.total;
  for (const s of p.sinCargar) de(s.rubro).sinCargar += s.ultimo;
  const meses = p.historia.length;
  if (meses) for (const h of p.historia) for (const r of h.rubros) de(r.rubro);

  const ventasHist = p.historia.reduce((s, h) => s + h.ventas, 0);
  for (const [k, r] of m) {
    const hist = p.historia.reduce((s, h) => s + h.rubros.filter((x) => norm(x.rubro) === k).reduce((a, x) => a + x.total, 0), 0);
    const objetivo = !meses ? 0
      : esMercaderia(r.rubro) ? (ventasHist > 0 ? (hist / ventasHist) * p.ventasProy : hist / meses)
      : hist / meses;
    const base = r.cargado + r.sinCargar;
    r.total = Math.max(base, objetivo);
    r.variable = r.total - base;
  }
  const rubros = [...m.values()].filter((r) => Math.abs(r.total) > 0.5).sort((a, b) => b.total - a.total);
  const suma = (f: (r: RubroProyectado) => number) => rubros.reduce((s, r) => s + f(r), 0);
  return { rubros, total: suma((r) => r.total), cargado: suma((r) => r.cargado), sinCargar: suma((r) => r.sinCargar), variable: suma((r) => r.variable) };
}
