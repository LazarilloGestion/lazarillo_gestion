import type { InsumoMaestro } from "@/lib/render/db";

export type InsumoComprado = { codigo: string; nombre: string; medida: string; codCga: string | null; unit: number | null; alic: number | null };
export type InsumoCarga = { codigo: string; nombre: string; medida: string; codCga: string | null; rubro: string | null; unit: number | null; alic: number | null };

// Insumos del modal de carga. El concepto de caja sale del RUBRO del insumo en
// MaxiRest (cada rubro de insumo tiene uno, Diego 27/10/2026); si el rubro no
// tiene, el de su última compra. Precio y alícuota: los de la última compra.
// Los discontinuados de MaxiRest no se ofrecen; los que solo están en el 25 sí.
export function unirInsumos(maestro: InsumoMaestro[], comprados: InsumoComprado[]): InsumoCarga[] {
  const compra = new Map(comprados.map((c) => [String(c.codigo).trim(), c]));
  const out: InsumoCarga[] = [];
  const vistos = new Set<string>();
  for (const m of maestro) {
    if (m.discontinuado) { vistos.add(m.codigo); continue; }
    const c = compra.get(m.codigo);
    out.push({
      codigo: m.codigo,
      nombre: m.nombre,
      medida: m.medida ?? c?.medida?.trim() ?? "",
      codCga: m.codCga ?? c?.codCga?.trim() ?? null,
      rubro: m.rubro,
      unit: c?.unit ?? m.precio,
      alic: c?.alic ?? null,
    });
    vistos.add(m.codigo);
  }
  for (const c of comprados) {
    const cod = String(c.codigo).trim();
    if (vistos.has(cod)) continue;
    out.push({ codigo: cod, nombre: c.nombre.trim(), medida: c.medida.trim(), codCga: c.codCga?.trim() || null, rubro: null, unit: c.unit, alic: c.alic });
  }
  // Nombres repetidos (el modal elige por nombre): se agrega el código al segundo.
  const cuenta = new Map<string, number>();
  for (const i of out) cuenta.set(i.nombre, (cuenta.get(i.nombre) ?? 0) + 1);
  return out
    .map((i) => (cuenta.get(i.nombre)! > 1 ? { ...i, nombre: `${i.nombre} (${i.codigo})` } : i))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}
