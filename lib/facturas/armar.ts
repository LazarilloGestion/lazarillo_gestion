import { createHash } from "crypto";
import { z } from "zod";

// Carga de facturas desde el Panel (Etapa 4, punto 1 — modal del prototipo v136).
// Una factura cargada en Lazarillo se guarda IGUAL que la traería MaxiRest:
//   - compras (informe 14): una fila por PDV + concepto de caja (neto + IVA + imp.
//     internos de sus registros) y una fila por percepción (133 IVA / 899 IIBB /
//     137 Ganancias), con el mismo formato de comprobante y de DETALLE que el kit.
//   - detalle_compras (informe 25): una línea por registro (insumo con su medida;
//     un concepto va como línea sin medida, como lo lista MaxiRest).
// Las filas quedan con origen = 'lazarillo'. Mientras se siga cargando también en
// MaxiRest, el import del 14 y del 25 saltea esos comprobantes: gana lo de
// Lazarillo y nunca se duplica (Diego, 26/10/2026).

export const ORIGEN_LAZARILLO = "lazarillo";

// Tipos del modal → letra de comprobante del 14 y etiqueta de DETALLE (gen14: ETQ).
export const TIPOS_COMPROBANTE = {
  FcA: { letra: "A", etiqueta: "A  ", signo: 1 },
  FcB: { letra: "B", etiqueta: "B  ", signo: 1 },
  FcC: { letra: "C", etiqueta: "C  ", signo: 1 },
  Ticket: { letra: "Z", etiqueta: "Tic ", signo: 1 },
  "NC-A": { letra: "NC", etiqueta: "NC  ", signo: -1 },
} as const;
export type TipoComprobante = keyof typeof TIPOS_COMPROBANTE;

// Percepciones del modal → concepto de caja de percepción (mismos que gen14).
export const CONCEPTO_PERCEPCION = {
  "Perc. IVA RG 3337": "133",
  "Perc. IIBB PBA": "899",
  "Perc. IIBB CABA": "899",
  "Perc. Ganancias": "137",
} as const;
export type TipoPercepcion = keyof typeof CONCEPTO_PERCEPCION;
const COLUMNA_PERCEPCION: Record<string, "per1" | "per2" | "per3"> = { "133": "per1", "899": "per2", "137": "per3" };

const dinero = z.number().finite();
const repartoSchema = z.array(z.object({ puntoDeVentaId: z.number().int(), pct: z.number().min(0).max(100) }));

export const registroSchema = z.object({
  tipo: z.enum(["concepto", "insumo"]),
  // concepto: su código de caja; insumo: el concepto de caja elegido para la línea
  conceptoCodigo: z.string().min(1),
  insumoCodigo: z.string().nullish(),
  nombre: z.string().min(1),
  medida: z.string().nullish(),
  cantidad: z.number().positive().nullish(),
  neto: dinero, // neto total de la línea (sin IVA)
  alicuota: z.number().min(0).max(100),
  impInt: dinero.default(0),
  puntoDeVentaId: z.number().int(),
  // Reparto explícito entre PDV (suma 100). Sin reparto = todo al PDV del registro.
  reparto: repartoSchema.nullish(),
});

export const facturaSchema = z.object({
  proveedorId: z.number().int(),
  tipo: z.enum(Object.keys(TIPOS_COMPROBANTE) as [TipoComprobante, ...TipoComprobante[]]),
  prefijo: z.string().regex(/^\d{1,4}$/),
  numero: z.string().regex(/^\d{1,8}$/),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  observacion: z.string().max(200).nullish(),
  registros: z.array(registroSchema).min(1),
  percepciones: z.array(z.object({
    tipo: z.enum(Object.keys(CONCEPTO_PERCEPCION) as [TipoPercepcion, ...TipoPercepcion[]]),
    importe: dinero,
  })).default([]),
  impIntGeneral: dinero.default(0),
});
export type FacturaInput = z.infer<typeof facturaSchema>;

export interface ProveedorRef { id: number; codigo: string }
export interface PdvRef { id: number; localId: number }
export interface ConceptoRef { codigo: string; nombre: string }

export interface FilaCompra {
  rowId: string;
  comprobante: string;
  codCga: string;
  concepto: string;
  fecha: string;
  codigo: string;
  detalle: string;
  observac: string | null;
  importe: number;
  impInt: number;
  per1: number;
  per2: number;
  per3: number;
  proveedorId: number;
  conceptoCodigo: string;
  localId: number;
  puntoDeVentaId: number;
  // Reparto explícito por PDV: la apertura automática no la vuelve a repartir.
  esBloqueado: boolean;
}

export interface LineaDetalle {
  rowId: string;
  codPro: string;
  codCpb: string;
  numero1: string;
  numero2: string;
  comprobante: string;
  fecha: string;
  codigo: string;
  nombre: string;
  medida: string | null;
  cantidad: number;
  neto: number;     // unitario
  totalIns: number; // neto de la línea
  ivaTot: number;
  impNtTot: number;
  tasa: number;
  codCga: string;
  nomCga: string;
  compraId: string | null;
  proveedorId: number;
  localId: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 24);

export function comprobanteDe(tipo: TipoComprobante, prefijo: string, numero: string) {
  const t = TIPOS_COMPROBANTE[tipo];
  const p = prefijo.padStart(4, "0"), n = numero.padStart(8, "0");
  return { comprobante: `${t.letra}${p}${n}`, detalle: `${t.etiqueta}${p}-${n}`, letra: t.letra, prefijo: p, numero: n, signo: t.signo };
}

// Reparte un importe en partes que suman exacto (el último absorbe el redondeo).
function partir(total: number, fracs: number[]): number[] {
  const out = fracs.map((f) => r2(total * f));
  const dif = r2(total - out.reduce((a, b) => a + b, 0));
  if (out.length) out[out.length - 1] = r2(out[out.length - 1] + dif);
  return out;
}

export function armarFactura(
  f: FacturaInput,
  ctx: { proveedor: ProveedorRef; pdvs: PdvRef[]; conceptos: ConceptoRef[] },
): { filas: FilaCompra[]; lineas: LineaDetalle[]; total: number } {
  const cpb = comprobanteDe(f.tipo, f.prefijo, f.numero);
  const localDe = new Map(ctx.pdvs.map((p) => [p.id, p.localId]));
  const nombreConcepto = new Map(ctx.conceptos.map((c) => [c.codigo, c.nombre]));
  const conceptoNombre = (cod: string) => nombreConcepto.get(cod) ?? cod;
  const local = (pdv: number) => {
    const l = localDe.get(pdv);
    if (l == null) throw new Error(`PDV ${pdv} desconocido`);
    return l;
  };
  const claveFila = (pdv: number, cga: string) =>
    `lz-${hash(`${local(pdv)}|${pdv}|${cpb.comprobante}|${ctx.proveedor.codigo}|${cga}`)}`;

  type Acum = Omit<FilaCompra, "importe" | "impInt" | "per1" | "per2" | "per3"> & { importe: number; impInt: number; per1: number; per2: number; per3: number };
  const filas = new Map<string, Acum>();
  const fila = (pdv: number, cga: string, bloqueado: boolean): Acum => {
    const rowId = claveFila(pdv, cga);
    let a = filas.get(rowId);
    if (!a) {
      a = {
        rowId, comprobante: cpb.comprobante, codCga: cga, concepto: conceptoNombre(cga), fecha: f.fecha,
        codigo: ctx.proveedor.codigo, detalle: cpb.detalle, observac: f.observacion?.trim() || null,
        importe: 0, impInt: 0, per1: 0, per2: 0, per3: 0,
        proveedorId: ctx.proveedor.id, conceptoCodigo: cga, localId: local(pdv), puntoDeVentaId: pdv,
        esBloqueado: bloqueado,
      };
      filas.set(rowId, a);
    }
    if (bloqueado) a.esBloqueado = true;
    return a;
  };

  const lineas: LineaDetalle[] = [];
  const pesoPdv = new Map<number, number>();
  f.registros.forEach((reg, idx) => {
    const partes = reg.reparto && reg.reparto.filter((x) => x.pct > 0).length >= 2
      ? reg.reparto.filter((x) => x.pct > 0)
      : [{ puntoDeVentaId: reg.puntoDeVentaId, pct: 100 }];
    const suma = partes.reduce((a, x) => a + x.pct, 0);
    const fracs = partes.map((x) => x.pct / suma);
    const bloqueado = partes.length >= 2;
    const iva = r2(reg.neto * reg.alicuota / 100);
    const netos = partir(reg.neto, fracs);
    const ivas = partir(iva, fracs);
    const imps = partir(reg.impInt, fracs);
    const cants = reg.cantidad ? fracs.map((x) => Math.round(reg.cantidad! * x * 1000) / 1000) : fracs.map(() => 1);
    partes.forEach((p, k) => {
      const a = fila(p.puntoDeVentaId, reg.conceptoCodigo, bloqueado);
      const importe = r2(netos[k] + ivas[k] + imps[k]);
      a.importe = r2(a.importe + importe * cpb.signo);
      a.impInt = r2(a.impInt + imps[k] * cpb.signo);
      pesoPdv.set(p.puntoDeVentaId, (pesoPdv.get(p.puntoDeVentaId) ?? 0) + importe);
      const esInsumo = reg.tipo === "insumo";
      const cantidad = esInsumo ? cants[k] : 1;
      lineas.push({
        rowId: `lz-${hash(`${a.rowId}|${idx}|${k}`)}`,
        codPro: ctx.proveedor.codigo, codCpb: cpb.letra, numero1: cpb.prefijo, numero2: cpb.numero,
        comprobante: cpb.comprobante, fecha: f.fecha,
        codigo: esInsumo ? (reg.insumoCodigo ?? reg.nombre) : reg.conceptoCodigo,
        nombre: reg.nombre, medida: esInsumo ? (reg.medida ?? null) : null,
        cantidad, neto: cantidad ? r2(netos[k] / cantidad) : netos[k], totalIns: netos[k],
        ivaTot: ivas[k], impNtTot: imps[k], tasa: reg.alicuota,
        codCga: reg.conceptoCodigo, nomCga: conceptoNombre(reg.conceptoCodigo),
        compraId: a.rowId, proveedorId: ctx.proveedor.id, localId: a.localId,
      });
    });
  });

  // Percepciones e imp. internos generales: al PDV con más peso en la factura.
  const pdvPrincipal = [...pesoPdv.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? f.registros[0].puntoDeVentaId;
  for (const p of f.percepciones) {
    if (!p.importe) continue;
    const cga = CONCEPTO_PERCEPCION[p.tipo];
    const a = fila(pdvPrincipal, cga, false);
    const imp = r2(p.importe * cpb.signo);
    a.importe = r2(a.importe + imp);
    a[COLUMNA_PERCEPCION[cga]] = r2(a[COLUMNA_PERCEPCION[cga]] + imp);
  }
  if (f.impIntGeneral) {
    const filaMayor = [...filas.values()].filter((x) => x.puntoDeVentaId === pdvPrincipal && !COLUMNA_PERCEPCION[x.codCga])
      .sort((a, b) => Math.abs(b.importe) - Math.abs(a.importe))[0];
    if (filaMayor) {
      filaMayor.importe = r2(filaMayor.importe + f.impIntGeneral * cpb.signo);
      filaMayor.impInt = r2(filaMayor.impInt + f.impIntGeneral * cpb.signo);
    }
  }

  const lista = [...filas.values()].filter((x) => x.importe !== 0);
  // Insumos bonificados (importe 0, Diego 27/10/2026): la línea va al detalle con su
  // cantidad; si su fila del 14 quedó en cero no se graba y la línea no la referencia.
  const grabadas = new Set(lista.map((x) => x.rowId));
  const lineasOk = lineas.map((l) => (l.compraId && grabadas.has(l.compraId) ? l : { ...l, compraId: null }));
  const total = r2(lista.reduce((a, x) => a + x.importe, 0));
  return { filas: lista, lineas: lineasOk, total };
}
