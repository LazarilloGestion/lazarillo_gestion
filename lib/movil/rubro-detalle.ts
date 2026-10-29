// Detalle de un rubro en "Gastos del mes por rubro" del celu (Diego 29/10/2026): al tocar
// el rubro se despliega, de mayor a menor. Personal por empleado (como la vista Proveedor
// del Panel); el resto por insumo o, si la factura no tiene detalle, por concepto (como la
// vista Insumos). En un mes proyectado se suman lo que falta cargar y el estimado del resto.

export interface LineaRubro { nombre: string; total: number; tipo: "cargado" | "sinCargar" | "estimado"; nota?: string }
type Fila = { nombre: string; rubroCodigo?: string; rowTotal: number; children?: { nombre: string; rowTotal: number }[] };

const norm = (t: string) => t.trim().toLowerCase();
export const esPersonal = (rubro: string) => /personal/i.test(rubro);

/** Líneas cargadas de un rubro, desde la respuesta del pivot (por proveedor o por insumo) del mes. */
export function cargadasDe(rows: Fila[] | undefined, rubro: string): LineaRubro[] {
  const r = (rows ?? []).find((x) => norm(x.nombre) === norm(rubro));
  const m = new Map<string, number>();
  for (const c of r?.children ?? []) {
    const k = c.nombre.trim();
    m.set(k, (m.get(k) ?? 0) + c.rowTotal);
  }
  return [...m].filter(([, t]) => Math.abs(t) > 0.5).map(([nombre, total]) => ({ nombre, total, tipo: "cargado" as const }));
}

export function lineasRubro(p: {
  rubro: string;
  cargadas: LineaRubro[];
  sinCargar: { rubro: string; nombre: string; ultimo: number }[];
  estimado: number;
}): LineaRubro[] {
  const sc = p.sinCargar.filter((s) => norm(s.rubro) === norm(p.rubro) && Math.abs(s.ultimo) > 0.5)
    .map((s) => ({ nombre: s.nombre, total: s.ultimo, tipo: "sinCargar" as const, nota: "sin cargar" }));
  const est = p.estimado > 0.5 ? [{ nombre: "Resto estimado", total: p.estimado, tipo: "estimado" as const, nota: "promedio" }] : [];
  return [...p.cargadas, ...sc, ...est].sort((a, b) => b.total - a.total);
}
