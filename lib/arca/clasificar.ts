// Cruce ARCA × Panel (Diego 28/10/2026). Puro: recibe los comprobantes de ARCA con lo que hay
// cargado con el mismo CUIT + punto de venta + número, y las compras de esos proveedores que
// no coinciden con ningún comprobante de ARCA; devuelve lo que falta cargar y lo que hay que
// corregir. Validado contra el CSV real de 2025 (ver scratchpad del 28/10).

/** ARCA es de la empresa, no de un PDV: sus descartes ("no va", "está bien") van con pdvId 0. */
export const PDV_ARCA = 0;

export interface Cargado { comprobante: string; localId: number; total: number; fecha: string; rowId: string }
export interface ArcaConCarga {
  key: string; cuit: string; emisor: string | null; tipo: number; puntoVenta: number; numero: number;
  fecha: string; total: number; otros: number; nc: boolean; proveedorId: number | null; proveedor: string | null;
  cargados: Cargado[];
}
export interface SinPar { cuit: string; comprobante: string; localId: number; total: number; fecha: string; rowId: string }

export type MotivoCorregir = "importe" | "numero" | "fecha" | "duplicado";
export interface Corregir { motivo: MotivoCorregir; arca: ArcaConCarga; panel: Cargado | SinPar; detalle: string }

const dias = (a: string, b: string) => Math.abs((Date.parse(a) - Date.parse(b)) / 86_400_000);
const $ = (n: number) => "$ " + Math.round(n).toLocaleString("es-AR");
// El total del Panel puede no traer la percepción (el 14 de 2025 no la tenía): vale igual.
const igual = (panel: number, a: ArcaConCarga, tol = 2) => Math.abs(Math.abs(panel) - a.total) <= tol || Math.abs(Math.abs(panel) - (a.total - a.otros)) <= tol;

export function clasificar(arca: ArcaConCarga[], sinPar: SinPar[]) {
  const faltan: ArcaConCarga[] = [];
  const corregir: Corregir[] = [];
  let ok = 0;
  const usados = new Set<string>();
  for (const a of arca) {
    if (!a.cargados.length) { faltan.push(a); continue; }
    const porLocal = new Map<number, Cargado[]>();
    for (const c of a.cargados) porLocal.set(c.localId, [...(porLocal.get(c.localId) ?? []), c]);
    let problema: Corregir | null = null;
    for (const cs of porLocal.values()) {
      const nombres = new Set(cs.map((c) => c.comprobante));
      const suma = cs.reduce((s, c) => s + c.total, 0);
      // El mismo número cargado dos veces en el mismo local ("A…" y "FCA…"): duplicado.
      if (nombres.size > 1 && igual(suma / 2, a)) {
        problema = { motivo: "duplicado", arca: a, panel: cs[0], detalle: `cargada 2 veces: ${[...nombres].join(" y ")}` };
        break;
      }
    }
    if (!problema) {
      const totales = [...porLocal.values()].map((cs) => cs.reduce((s, c) => s + c.total, 0));
      // Repartida en 2 locales (IVA compensación) vale si alguno coincide.
      if (!totales.some((t) => igual(t, a)) && a.total > 0) {
        const t = totales[0];
        if (Math.abs(Math.abs(t) - a.total) > Math.max(2, a.total * 0.01)) {
          problema = { motivo: "importe", arca: a, panel: a.cargados[0], detalle: `ARCA ${$(a.total)} · cargada ${$(Math.abs(t))}` };
        }
      }
    }
    if (!problema) {
      const c = a.cargados[0];
      if (dias(c.fecha, a.fecha) > 3) problema = { motivo: "fecha", arca: a, panel: c, detalle: `ARCA ${a.fecha.split("-").reverse().join("/")} · cargada ${c.fecha.split("-").reverse().join("/")}` };
    }
    if (problema) corregir.push(problema); else ok++;
  }
  // Faltantes que parecen cargados con OTRO número: mismo proveedor, mismo importe, fecha cerca.
  const quedan: ArcaConCarga[] = [];
  for (const a of faltan) {
    const par = sinPar.find((s) => s.cuit === a.cuit && !usados.has(s.rowId) && igual(s.total, a) && dias(s.fecha, a.fecha) <= 20);
    if (par) {
      usados.add(par.rowId);
      corregir.push({ motivo: "numero", arca: a, panel: par, detalle: `en ARCA Nº ${a.puntoVenta}-${a.numero} · cargada como ${par.comprobante}` });
    } else quedan.push(a);
  }
  return { ok, faltan: quedan, corregir };
}
