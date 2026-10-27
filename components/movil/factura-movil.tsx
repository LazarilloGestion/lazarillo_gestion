"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useFetchQuery } from "@/hooks/use-fetch-query";
import { useMediosPago } from "@/hooks/use-medios-pago";
import { mediosParaElegir } from "@/lib/medios-pago/abm";
import { normalizarBusqueda } from "@/lib/impagas/clasificar";
import { soloDigitos, type DatosQr } from "@/lib/movil/qr-arca";
import { escalarA, totalFactura } from "@/lib/movil/escalar";
import type { FacturaInput } from "@/lib/facturas/armar";
import type { Maestros } from "@/components/facturas/cargar-factura";

// Carga de una factura desde el celular (Diego 27/10/2026). Con QR de ARCA vienen
// proveedor (por CUIT), tipo, número, fecha y total; los renglones salen de la
// última factura del proveedor llevada a ese total, y se corrigen acá. Se guarda
// con el mismo POST que la carga de la compu (mismas validaciones, nunca duplica).

const TIPOS = ["FcA", "FcB", "FcC", "Ticket", "NC-A"] as const;
const ALICUOTAS = [21, 10.5, 27, 0];
const r2 = (n: number) => Math.round(n * 100) / 100;
const $ = (n: number) => "$ " + n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const aTexto = (n: number) => (n ? n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "");
const aNumero = (t: string) => { const v = parseFloat(t.replace(/\./g, "").replace(",", ".")); return Number.isFinite(v) ? v : 0; };
const hoy = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

type Registro = FacturaInput["registros"][number];
type Estructura = Pick<FacturaInput, "registros" | "percepciones" | "impIntGeneral">;

const lbl = "block text-[11px] font-bold uppercase tracking-wide text-zinc-500 mt-3 mb-1";
const inp = "w-full h-11 rounded-xl border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 px-3 text-[15px]";

function ImporteCampo({ valor, onCambio, className }: { valor: number; onCambio: (n: number) => void; className?: string }) {
  const [txt, setTxt] = useState(aTexto(valor));
  const [foco, setFoco] = useState(false);
  const mostrado = foco ? txt : aTexto(valor);
  return (
    <input inputMode="decimal" value={mostrado} className={className}
      onFocus={() => { setTxt(aTexto(valor)); setFoco(true); }}
      onBlur={() => { setFoco(false); onCambio(r2(aNumero(txt))); }}
      onChange={(e) => { const t = e.target.value.replace(/[^\d.,]/g, ""); setTxt(t); onCambio(r2(aNumero(t))); }} />
  );
}

export function FacturaMovil({ qr, localId, pdvId, onCerrar }: {
  qr: DatosQr | null; localId: number; pdvId: number; onCerrar: () => void;
}) {
  const queryClient = useQueryClient();
  const { data: maestros } = useFetchQuery<Maestros>(["facturas-maestros"], "/api/facturas/maestros", { staleTime: 15 * 60_000 });
  const proveedores = useMemo(() => maestros?.proveedores ?? [], [maestros]);
  const porCuit = qr ? proveedores.find((p) => soloDigitos(p.cuit) === qr.cuit) : undefined;
  const [provSel, setProvSel] = useState<number | null>(null);
  const provId = provSel ?? porCuit?.id ?? null;
  const prov = proveedores.find((p) => p.id === provId) ?? null;
  const [busca, setBusca] = useState("");

  const [tipo, setTipo] = useState<string>(qr?.tipo ?? "FcA");
  const [pv, setPv] = useState(qr ? String(qr.ptoVta).padStart(4, "0") : "");
  const [nro, setNro] = useState(qr ? String(qr.numero).padStart(8, "0") : "");
  const [fecha, setFecha] = useState(qr?.fecha ?? hoy());

  // Estructura: la última factura del proveedor (en este local), llevada al total del QR.
  const { data: ult, isFetching: buscandoUlt } = useFetchQuery<{ ultima: { factura: FacturaInput } | null }>(
    ["facturas-ultima", provId, localId], provId ? `/api/facturas/ultima?proveedorId=${provId}&localId=${localId}` : null,
  );
  const [est, setEst] = useState<Estructura | null>(null);
  const [estDe, setEstDe] = useState<number | null>(null);
  // Al llegar la última factura del proveedor elegido, se arma la estructura (una vez por proveedor).
  if (provId && ult && estDe !== provId) {
    const u = ult.ultima?.factura;
    const base: Estructura = u
      ? { registros: u.registros.map((r) => ({ ...r })), percepciones: u.percepciones.map((p) => ({ ...p })), impIntGeneral: u.impIntGeneral ?? 0 }
      : { registros: [], percepciones: [], impIntGeneral: 0 };
    setEst(qr && base.registros.length ? escalarA(base, qr.importe) : base);
    setEstDe(provId);
  }

  const conceptos = maestros?.conceptos ?? [];
  const [nuevoConc, setNuevoConc] = useState("");
  const total = est ? totalFactura(est) : 0;
  const difQr = qr ? r2(total - qr.importe) : 0;

  const { data: mediosData } = useMediosPago();
  const medios = mediosParaElegir(mediosData);
  const [pagar, setPagar] = useState(false);
  const [medio, setMedio] = useState("");
  const [fechaPago, setFechaPago] = useState(hoy());
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setReg = (i: number, cambio: Partial<Registro>) => setEst((e) => e && { ...e, registros: e.registros.map((r, ix) => (ix === i ? { ...r, ...cambio } : r)) });

  async function guardar() {
    setError(null);
    if (!prov) { setError("Elegí el proveedor."); return; }
    if (!pv || !nro || Number(nro) === 0) { setError("Falta el número de comprobante."); return; }
    if (!est || !est.registros.some((r) => r.neto > 0)) { setError("Agregá al menos un renglón con importe."); return; }
    if (qr && Math.abs(difQr) > 1) { setError(`El total no da: ${$(total)} contra ${$(qr.importe)} del QR. Ajustá los importes.`); return; }
    const medioPago = medio || medios[0]?.nombre;
    if (pagar && !medioPago) { setError("Elegí el medio de pago."); return; }
    setGuardando(true);
    try {
      const body = {
        proveedorId: prov.id, tipo, prefijo: pv.padStart(4, "0"), numero: nro.padStart(8, "0"), fecha, observacion: null,
        registros: est.registros.filter((r) => r.neto > 0 || (r.tipo === "insumo" && (r.cantidad ?? 0) > 0)).map((r) => ({ ...r, puntoDeVentaId: r.puntoDeVentaId || pdvId })),
        percepciones: est.percepciones.filter((p) => p.importe > 0),
        impIntGeneral: est.impIntGeneral ?? 0,
        ...(pagar ? { pago: { fecha: fechaPago, medio: medioPago, referencia: null, pdvPagaId: pdvId } } : {}),
      };
      const res = await fetch("/api/facturas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await res.json().catch(() => null);
      if (!res.ok) { setError([d?.error ?? "No se pudo guardar.", ...((d?.detalle as string[] | undefined) ?? [])].join(" ")); return; }
      toast.success(pagar ? "Factura cargada y pagada" : "Factura cargada", { description: `${prov.nombre ?? ""} · ${$(d.total)}` });
      for (const k of ["pivot", "detalle", "impagas", "cta-cte", "actividad", "m-resumen"]) void queryClient.invalidateQueries({ queryKey: [k] });
      onCerrar();
    } catch {
      setError("Error de red: no se guardó.");
    } finally {
      setGuardando(false);
    }
  }

  const opcionesProv = busca.trim().length >= 2
    ? proveedores.filter((p) => normalizarBusqueda(`${p.nombre ?? ""} ${p.razon ?? ""}`).includes(normalizarBusqueda(busca))).slice(0, 8)
    : [];

  return (
    <div className="pb-6">
      {qr && (
        <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/40 px-3 py-2 text-[13px] text-emerald-800 dark:text-emerald-300">
          ✓ QR leído: {qr.tipo} {String(qr.ptoVta).padStart(4, "0")}-{String(qr.numero).padStart(8, "0")} · {qr.fecha.split("-").reverse().join("/")} · <b>{$(qr.importe)}</b>
        </div>
      )}

      <span className={lbl}>Proveedor {qr && porCuit && <span className="ml-1 rounded bg-emerald-50 px-1 text-emerald-700 normal-case">✓ por CUIT</span>}</span>
      {prov ? (
        <div className="flex items-center gap-2">
          <div className={`${inp} flex items-center font-semibold`}>{prov.nombre ?? prov.razon}</div>
          <button type="button" onClick={() => { setProvSel(-1); setEst(null); setEstDe(null); setBusca(""); }} className="shrink-0 text-[13px] text-sky-700 underline">cambiar</button>
        </div>
      ) : (
        <>
          {qr && !porCuit && <div className="mb-1 text-[12.5px] text-amber-700">El CUIT {qr.cuit} no está en el maestro de proveedores: buscalo por nombre.</div>}
          <input className={inp} value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar proveedor…" autoComplete="off" />
          {opcionesProv.map((p) => (
            <button key={p.id} type="button" onClick={() => { setProvSel(p.id); setBusca(""); }}
              className="block w-full border-b border-zinc-100 dark:border-zinc-800 px-2 py-2.5 text-left text-[15px]">{p.nombre ?? p.razon}</button>
          ))}
        </>
      )}

      <div className="grid grid-cols-[96px_70px_1fr] gap-2">
        <div><span className={lbl}>Tipo</span>
          <select className={inp} value={tipo} onChange={(e) => setTipo(e.target.value)}>{TIPOS.map((t) => <option key={t}>{t}</option>)}</select></div>
        <div><span className={lbl}>P. vta</span><input className={inp} inputMode="numeric" maxLength={4} value={pv} onChange={(e) => setPv(e.target.value.replace(/\D/g, ""))} /></div>
        <div><span className={lbl}>Número</span><input className={inp} inputMode="numeric" maxLength={8} value={nro} onChange={(e) => setNro(e.target.value.replace(/\D/g, ""))} /></div>
      </div>
      <span className={lbl}>Fecha de la factura</span>
      <input type="date" className={inp} value={fecha} onChange={(e) => setFecha(e.target.value)} />

      {prov && (
        <>
          <span className={lbl}>Renglones {ult?.ultima && <span className="normal-case font-normal text-zinc-500">· como la última de este proveedor{qr ? ", llevada al total del QR" : ""}</span>}</span>
          {buscandoUlt && !est && <p className="text-[13px] text-zinc-500">Buscando la última factura…</p>}
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 divide-y divide-zinc-100 dark:divide-zinc-800">
            {est?.registros.map((r, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px]">{r.nombre}</div>
                  <div className="text-[12px] text-zinc-500">{r.cantidad ? `${r.cantidad} ${r.medida ?? ""} · ` : ""}
                    <select value={r.alicuota} onChange={(e) => setReg(i, { alicuota: Number(e.target.value) })} className="bg-transparent">
                      {ALICUOTAS.map((a) => <option key={a} value={a}>IVA {a}%</option>)}
                    </select>
                  </div>
                </div>
                <ImporteCampo valor={r.neto} onCambio={(n) => setReg(i, { neto: n })} className="h-10 w-32 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 px-2 text-right text-[15px] tabular-nums" />
                <button type="button" onClick={() => setEst((e) => e && { ...e, registros: e.registros.filter((_, ix) => ix !== i) })} className="px-1 text-zinc-400" aria-label="Sacar">×</button>
              </div>
            ))}
            {est?.percepciones.map((p, i) => (
              <div key={`p${i}`} className="flex items-center gap-2 px-3 py-2">
                <div className="flex-1 truncate text-[14px]">{p.tipo}</div>
                <ImporteCampo valor={p.importe} onCambio={(n) => setEst((e) => e && { ...e, percepciones: e.percepciones.map((x, ix) => (ix === i ? { ...x, importe: n } : x)) })}
                  className="h-10 w-32 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 px-2 text-right text-[15px] tabular-nums" />
                <span className="w-5" />
              </div>
            ))}
            <div className="flex items-center gap-2 px-3 py-2">
              <select className="h-10 flex-1 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 px-2 text-[14px]" value={nuevoConc} onChange={(e) => setNuevoConc(e.target.value)}>
                <option value="">+ Agregar concepto…</option>
                {conceptos.map((c) => <option key={c.codigo} value={c.codigo}>{c.nombre} ({c.rubro})</option>)}
              </select>
              <button type="button" disabled={!nuevoConc}
                onClick={() => {
                  const c = conceptos.find((x) => x.codigo === nuevoConc);
                  if (!c) return;
                  setEst((e) => ({ ...(e ?? { registros: [], percepciones: [], impIntGeneral: 0 }),
                    registros: [...(e?.registros ?? []), { tipo: "concepto", conceptoCodigo: c.codigo, insumoCodigo: null, nombre: c.nombre, medida: null, cantidad: null, neto: 0, alicuota: 21, impInt: 0, puntoDeVentaId: pdvId, reparto: null } as Registro] }));
                  setNuevoConc("");
                }}
                className="h-10 rounded-lg bg-zinc-900 px-3 text-[14px] text-white disabled:opacity-30 dark:bg-white dark:text-zinc-900">Agregar</button>
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between text-[15px]">
            <span className="text-zinc-500">Total</span>
            <b className="tabular-nums">{$(total)}</b>
          </div>
          {qr && Math.abs(difQr) > 1 && (
            <div className="mt-1 flex items-center justify-between gap-2 rounded-xl bg-red-50 dark:bg-red-950/40 px-3 py-2 text-[13px] text-red-700">
              <span>No da con el QR: {difQr > 0 ? "sobran" : "faltan"} {$(Math.abs(difQr))}</span>
              {est && est.registros.length > 0 && <button type="button" onClick={() => setEst(escalarA(est, qr.importe))} className="shrink-0 underline font-semibold">Ajustar al total</button>}
            </div>
          )}

          <label className="mt-4 flex items-center gap-2.5 text-[15px] font-semibold">
            <input type="checkbox" checked={pagar} onChange={(e) => setPagar(e.target.checked)} className="size-5" />
            Registrar el pago ahora
          </label>
          {pagar && (
            <div className="grid grid-cols-2 gap-2">
              <div><span className={lbl}>Medio</span>
                <select className={inp} value={medio || medios[0]?.nombre || ""} onChange={(e) => setMedio(e.target.value)}>
                  {medios.map((m) => <option key={m.id} value={m.nombre}>{m.nombre}</option>)}
                </select></div>
              <div><span className={lbl}>Fecha de pago</span><input type="date" className={inp} value={fechaPago} onChange={(e) => setFechaPago(e.target.value)} /></div>
            </div>
          )}
        </>
      )}

      {error && <div className="mt-3 rounded-xl bg-red-50 dark:bg-red-950/40 px-3 py-2 text-[13px] text-red-700">{error}</div>}
      <button type="button" disabled={guardando || !prov} onClick={() => void guardar()}
        className="mt-4 h-12 w-full rounded-2xl bg-zinc-900 text-[15px] font-bold text-white disabled:opacity-40 dark:bg-white dark:text-zinc-900">
        {guardando ? "Guardando…" : "Guardar factura"}
      </button>
      <button type="button" onClick={onCerrar} className="mt-2 h-11 w-full rounded-2xl border border-zinc-300 dark:border-zinc-600 text-[15px]">Cancelar</button>
    </div>
  );
}
