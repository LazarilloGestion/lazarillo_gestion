// Pagos a proveedores cargados en Lazarillo (Etapa 4, Diego 27/10/2026). Puro (sin
// Prisma): lo usan el servidor, la cuenta corriente y los tests.
//
// El pago cuelga de la FACTURA ENTERA (PDV + comprobante + proveedor), no de una fila
// del 14. Por ahora conviven los pagos del informe 80 (MaxiRest) y los de Lazarillo:
// un pago de Lazarillo con el mismo importe (±$1) y fecha cercana (±10 días) que uno
// del 80 es el mismo pago cargado en los dos lados y se cuenta una sola vez (manda el
// 80). Si igual entre los dos pasan el total, se avisa "pagada de más".

const r2 = (n: number) => Math.round(n * 100) / 100;
const DIAS_CONCILIA = 10;
const dias = (a: string, b: string) => Math.abs(Date.parse(`${a.slice(0, 10)}T00:00:00Z`) - Date.parse(`${b.slice(0, 10)}T00:00:00Z`)) / 86_400_000;

export interface PagoSimple { fecha: string; importe: number }

export interface PagadoCombinado {
  pagado: number;         // lo que cuenta como pagado
  conciliados: number[];  // índices de los pagos de Lazarillo que ya trae el 80 (no se suman)
  deMas: boolean;         // pagada de más
}

export function combinarPagos(pagos80: PagoSimple[], pagosLz: PagoSimple[], total: number): PagadoCombinado {
  const usados = new Set<number>();
  const conciliados: number[] = [];
  pagosLz.forEach((p, i) => {
    const j = pagos80.findIndex((q, jx) => !usados.has(jx) && Math.abs(q.importe - p.importe) <= 1 && dias(q.fecha, p.fecha) <= DIAS_CONCILIA);
    if (j >= 0) { usados.add(j); conciliados.push(i); }
  });
  const suma80 = pagos80.reduce((s, p) => s + p.importe, 0);
  const sumaLz = pagosLz.reduce((s, p, i) => s + (conciliados.includes(i) ? 0 : p.importe), 0);
  const pagado = r2(suma80 + sumaLz);
  return { pagado, conciliados, deMas: Math.abs(total) > 0.5 && pagado > total + 1 };
}

export interface FacturaAImputar { key: string; fecha: string; saldo: number }

// Imputa un importe a facturas elegidas, de la más vieja a la más nueva. Sin importe,
// salda cada una entera. Lo que sobra queda a cuenta del proveedor.
export function imputarFacturas(facturas: FacturaAImputar[], importe?: number): { aplicaciones: { key: string; importe: number }[]; sobrante: number } {
  const orden = [...facturas].filter((f) => f.saldo > 0.004).sort((a, b) => a.fecha.localeCompare(b.fecha) || a.key.localeCompare(b.key));
  const aplicaciones: { key: string; importe: number }[] = [];
  if (importe === undefined) {
    for (const f of orden) aplicaciones.push({ key: f.key, importe: r2(f.saldo) });
    return { aplicaciones, sobrante: 0 };
  }
  let resto = r2(importe);
  for (const f of orden) {
    if (resto <= 0.004) break;
    const x = r2(Math.min(resto, f.saldo));
    aplicaciones.push({ key: f.key, importe: x });
    resto = r2(resto - x);
  }
  return { aplicaciones, sobrante: Math.max(0, resto) };
}

// Bajar el importe de un pago: si ya no alcanza para lo imputado, se suelta lo de las
// facturas más nuevas primero (la más vieja queda pagada). Devuelve cómo queda cada imputación.
export function recortarAplicaciones<T extends { id: number; fecha: string; importe: number }>(apl: T[], importe: number): { id: number; importe: number }[] {
  let sobra = r2(apl.reduce((s, a) => s + a.importe, 0) - importe);
  const res = new Map(apl.map((a) => [a.id, a.importe]));
  for (const a of [...apl].sort((x, y) => y.fecha.localeCompare(x.fecha) || y.id - x.id)) {
    if (sobra <= 0.004) break;
    const x = r2(Math.min(sobra, a.importe));
    res.set(a.id, r2(a.importe - x));
    sobra = r2(sobra - x);
  }
  return [...res.entries()].map(([id, imp]) => ({ id, importe: imp }));
}

export const numeroPago = (id: number) => `Pago Nº ${id}`;
export const claveFactura = (pdvId: number, comprobante: string) => `${pdvId}|${comprobante}`;
