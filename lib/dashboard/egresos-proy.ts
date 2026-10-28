import { proyectarGastos, type RubroProyectado } from "@/lib/movil/proyeccion-gastos";

// Egresos del tablero general (Diego 28/10/2026): el mes en curso proyectado al cierre con el
// mismo cálculo que el celu (cargado + lo que falta cargar + variable por rubro), y en los meses
// cerrados, lo que falta cargar como aviso. Puro: sin Prisma, se usa en el navegador.

export interface MesAnual { mes: number; ventas: number; rubros: { rubro: string; total: number }[] }
export interface EgresosProyectados {
  mes: number;
  total: number;        // lo que muestra la celda
  cargado: number;      // lo cargado (el valor del pivot)
  sinCargar: number;
  variable: number;
  rubros: RubroProyectado[];
  foodCost: number | null; // mercaderías / ventas de los meses de la historia
}

/** Los 3 meses anteriores al proyectado con ventas, del mismo año (los de la historia). */
export function historiaDe(anual: MesAnual[], mesProy: number): MesAnual[] {
  return anual.filter((m) => m.mes < mesProy && m.mes >= mesProy - 3 && m.ventas > 0);
}

export function egresosProyectados(p: {
  anual: MesAnual[];
  mesProy: number;
  ventasProy: number;
  cargadoPivot: number;
  sinCargar: { rubro: string; ultimo: number }[];
}): EgresosProyectados | null {
  const actual = p.anual.find((m) => m.mes === p.mesProy);
  const historia = historiaDe(p.anual, p.mesProy);
  if (!historia.length) return null;
  const g = proyectarGastos({ cargado: actual?.rubros ?? [], sinCargar: p.sinCargar, historia, ventasProy: p.ventasProy });
  // La celda parte del valor del pivot (mismos filtros que el resto de la fila) y le suma lo
  // que la proyección agrega encima de lo cargado.
  const extra = g.sinCargar + g.variable;
  const ventasHist = historia.reduce((s, h) => s + h.ventas, 0);
  const merc = historia.reduce((s, h) => s + h.rubros.filter((r) => /mercader/i.test(r.rubro)).reduce((a, r) => a + r.total, 0), 0);
  return {
    mes: p.mesProy,
    total: p.cargadoPivot + extra,
    cargado: p.cargadoPivot,
    sinCargar: g.sinCargar,
    variable: g.variable,
    rubros: g.rubros,
    foodCost: ventasHist > 0 && merc > 0 ? merc / ventasHist : null,
  };
}
