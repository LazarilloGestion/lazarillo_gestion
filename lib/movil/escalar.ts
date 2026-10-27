import type { FacturaInput } from "@/lib/facturas/armar";

// Carga desde el celular: el QR trae el total pero no los renglones. Se usa la
// estructura de la última factura del proveedor (como "Repetir") y se lleva a ese
// total en proporción; el usuario después corrige los importes que cambien. Puro.

const r2 = (n: number) => Math.round(n * 100) / 100;

// Total como lo arma el servidor (IVA redondeado por renglón).
export function totalFactura(f: Pick<FacturaInput, "registros" | "percepciones" | "impIntGeneral">): number {
  const regs = f.registros.reduce((s, r) => s + r.neto + r2(r.neto * r.alicuota / 100) + (r.impInt ?? 0), 0);
  return r2(regs + f.percepciones.reduce((s, p) => s + p.importe, 0) + (f.impIntGeneral ?? 0));
}

export function escalarA<T extends Pick<FacturaInput, "registros" | "percepciones" | "impIntGeneral">>(f: T, objetivo: number): T {
  const base = totalFactura(f);
  if (!(base > 0) || !(objetivo > 0)) return f;
  const k = objetivo / base;
  const out = {
    ...f,
    registros: f.registros.map((r) => ({ ...r, neto: r2(r.neto * k), impInt: r2((r.impInt ?? 0) * k) })),
    percepciones: f.percepciones.map((p) => ({ ...p, importe: r2(p.importe * k) })),
    impIntGeneral: r2((f.impIntGeneral ?? 0) * k),
  };
  // Lo que falte por redondeo va al renglón más grande.
  const dif = r2(objetivo - totalFactura(out));
  if (Math.abs(dif) >= 0.01 && out.registros.length) {
    const i = out.registros.reduce((m, r, ix, a) => (r.neto > a[m].neto ? ix : m), 0);
    const r = out.registros[i];
    out.registros[i] = { ...r, neto: r2(r.neto + dif / (1 + r.alicuota / 100)) };
    const resto = r2(objetivo - totalFactura(out));
    if (Math.abs(resto) >= 0.01) out.registros[i] = { ...out.registros[i], neto: r2(out.registros[i].neto + resto) };
  }
  return out as T;
}
