"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { fmtPesos } from "@/lib/impagas/clasificar";
import { importeAInput, normalizarReferencia, parsearImporteAR } from "@/lib/impagas/aperturas";
import { FechaInput, ImporteInput, hoyISO } from "@/components/impagas/deuda-pdv";
import { useMediosPago } from "@/hooks/use-medios-pago";
import { mediosParaElegir } from "@/lib/medios-pago/abm";
import { numeroPago } from "@/lib/pagos-proveedor/imputar";

// Barra de pago de la cuenta corriente del proveedor (Etapa 4, prototipo v136 con la
// barra de Impagas): pagar las facturas tildadas, cargar un pago a cuenta o corregir uno.

export interface PagoACuentaUI { id: number; fecha: string; importe: number; medio: string; referencia: string | null; pdvPagaId: number; disponible: number }
export interface PagoEditable { id: number; fecha: string; medio: string; referencia: string | null; pdvPagaId: number; importe: number }

export type ModoPagoProv =
  | { tipo: "facturas"; n: number; saldo: number } // tildadas: salda de la más vieja a la más nueva
  | { tipo: "cuenta" }                               // sin tildar: a cuenta
  | { tipo: "editar"; pago: PagoEditable };

export interface CuerpoPagoProv {
  fecha?: string; medio?: string; referencia?: string | null; pdvPagaId?: number; importe?: number; usarPago?: number;
}

export function FormPagoProveedor({ modo, proveedor, pdvs, pdvDefault, aCuenta, guardando, onCancel, onConfirm }: {
  modo: ModoPagoProv;
  proveedor: string;
  pdvs: { id: number; label: string }[];
  pdvDefault: number | null;
  aCuenta: PagoACuentaUI[];
  guardando: boolean;
  onCancel: () => void;
  onConfirm: (b: CuerpoPagoProv) => Promise<string | null>;
}) {
  const editando = modo.tipo === "editar";
  const base = modo.tipo === "facturas" ? modo.saldo : editando ? modo.pago.importe : 0;
  const [importe, setImporte] = useState(base > 0 ? importeAInput(base) : "");
  const [fecha, setFecha] = useState(editando ? modo.pago.fecha : hoyISO());
  const { data: medios } = useMediosPago();
  const lista = mediosParaElegir(medios, editando ? modo.pago.medio : null);
  const [medioSel, setMedio] = useState<string>(editando ? modo.pago.medio : "");
  const medio = medioSel || lista[0]?.nombre || "";
  const [referencia, setReferencia] = useState(editando ? modo.pago.referencia ?? "" : "");
  const [pdvPaga, setPdvPaga] = useState<number | null>(editando ? modo.pago.pdvPagaId : pdvDefault ?? pdvs[0]?.id ?? null);
  const [error, setError] = useState<string | null>(null);
  // "cuenta:ID" = usar el disponible de un pago a cuenta (no crea otro pago).
  const usado = medio.startsWith("cuenta:") ? aCuenta.find((p) => p.id === Number(medio.slice(7))) ?? null : null;
  const conId = !usado && (lista.find((m) => m.nombre === medio)?.pideId ?? false);

  // Al tildar o destildar, el importe se rearma con la nueva suma.
  const [baseVista, setBaseVista] = useState(base);
  if (baseVista !== base) {
    setBaseVista(base);
    setImporte(importeAInput(usado ? Math.min(base, usado.disponible) : base));
  }
  const valor = parsearImporteAR(importe) ?? 0;

  function cambiarMedio(v: string) {
    setMedio(v);
    const p = v.startsWith("cuenta:") ? aCuenta.find((x) => x.id === Number(v.slice(7))) : null;
    if (p && valor > p.disponible) setImporte(importeAInput(p.disponible));
  }

  async function confirmar() {
    setError(null);
    if (editando) {
      if (!medio) { setError("Elegí un medio de pago."); return; }
      if (pdvPaga == null) { setError("Elegí qué PDV paga."); return; }
      let ref: string | null = null;
      if (conId && referencia.trim()) { ref = normalizarReferencia(referencia); if (!ref) { setError("El ID tiene que ser de letras y números."); return; } }
      if (!(valor > 0)) { setError("Cargá un importe."); return; }
      const err = await onConfirm({ fecha, medio, referencia: ref, pdvPagaId: pdvPaga, importe: valor });
      if (err) setError(err);
      return;
    }
    if (!(valor > 0)) { setError("Cargá un importe."); return; }
    if (usado) {
      if (valor > usado.disponible + 0.005) { setError(`${numeroPago(usado.id)} tiene ${fmtPesos(usado.disponible)} disponibles.`); return; }
      const err = await onConfirm({ usarPago: usado.id, importe: valor });
      if (err) setError(err);
      return;
    }
    if (!medio) { setError("Elegí un medio de pago (se dan de alta en Medios de pago, en el menú)."); return; }
    if (pdvPaga == null) { setError("Elegí qué PDV paga."); return; }
    let ref: string | null = null;
    if (conId && referencia.trim()) { ref = normalizarReferencia(referencia); if (!ref) { setError("El ID tiene que ser de letras y números."); return; } }
    const err = await onConfirm({ fecha, medio, referencia: ref, pdvPagaId: pdvPaga, importe: valor });
    if (err) setError(err);
  }

  const input = "h-8 rounded-md border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-2 text-sm";
  const etiqueta = "w-12 shrink-0 text-muted-foreground";
  const titulo = modo.tipo === "facturas" ? `Pagar ${modo.n} factura${modo.n === 1 ? "" : "s"} · ${proveedor}`
    : modo.tipo === "cuenta" ? `Pago a cuenta · ${proveedor}` : `Editar ${numeroPago(modo.pago.id)}`;
  const excedente = modo.tipo === "facturas" && !usado ? valor - modo.saldo : 0;
  const ayuda = editando
    ? (valor > modo.pago.importe + 0.005 ? `Lo que sumás (${fmtPesos(valor - modo.pago.importe)}) queda a cuenta de ${proveedor}.`
      : valor < modo.pago.importe - 0.005 ? "Si no alcanza para lo que ya pagó, se suelta primero lo de las facturas más nuevas (quedan parciales o impagas)."
      : "Fecha, medio, ID, PDV que paga e importe.")
    : usado ? `No crea un pago nuevo: se aplica el disponible de ${numeroPago(usado.id)}, de la factura más vieja a la más nueva.`
    : modo.tipo === "cuenta" ? `Queda a cuenta de ${proveedor}. Después lo aplicás tildando facturas.`
    : excedente > 0.5 ? `Salda las facturas tildadas y ${fmtPesos(excedente)} quedan a cuenta de ${proveedor}.`
    : valor < modo.saldo - 0.005 ? "Se imputa de la más vieja a la más nueva; la última queda parcial."
    : "Salda las facturas tildadas, de la más vieja a la más nueva.";

  return (
    <div className="border-t border-sky-200 dark:border-sky-900 bg-sky-50 dark:bg-sky-950 px-6 py-3 shadow-[0_-4px_10px_rgba(0,0,0,0.06)] shrink-0 -mx-6">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex items-baseline gap-2 text-sm">
            <b className="whitespace-nowrap">{titulo}</b>
            {modo.tipo === "facturas" && <span className="tabular-nums text-muted-foreground whitespace-nowrap">Saldo {fmtPesos(modo.saldo)}</span>}
          </div>
          <div className="grid w-fit grid-cols-[auto_auto_auto] items-center gap-x-5 gap-y-2 text-sm">
            <label className="flex items-center gap-1.5"><span className={etiqueta}>Importe</span>
              <ImporteInput value={importe} onChange={setImporte} className={cn(input, "w-40 text-right tabular-nums")} />
            </label>
            <label className="flex items-center gap-1.5"><span className={etiqueta}>Medio</span>
              <select value={medio} onChange={(e) => cambiarMedio(e.target.value)} className={cn(input, "w-56")}>
                {lista.map((m) => <option key={m.id} value={m.nombre}>{m.nombre}{m.activo ? "" : " (desactivado)"}</option>)}
                {modo.tipo === "facturas" && aCuenta.length > 0 && (
                  <optgroup label="Usar un pago a cuenta">
                    {aCuenta.map((p) => <option key={p.id} value={`cuenta:${p.id}`}>A cuenta — {numeroPago(p.id)} · disponible {fmtPesos(p.disponible)}</option>)}
                  </optgroup>
                )}
              </select>
            </label>
            {!usado ? (
              <label className="flex items-center gap-1.5"><span className={etiqueta}>Fecha</span>
                <FechaInput value={fecha} onChange={setFecha} className={cn(input, "w-32 tabular-nums")} />
              </label>
            ) : <span />}
            {!usado && (
              <label className="flex items-center gap-1.5"><span className={etiqueta}>Paga</span>
                <select value={pdvPaga ?? ""} onChange={(e) => setPdvPaga(Number(e.target.value))} className={cn(input, "w-56")}>
                  {pdvs.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </label>
            )}
            {conId && (
              <label className="flex items-center gap-1.5"><span className={etiqueta}>ID</span>
                <input value={referencia} onChange={(e) => setReferencia(e.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase())}
                  placeholder="opcional" className={cn(input, "w-56 font-mono")} />
              </label>
            )}
          </div>
          <div className="mt-1.5 text-[11px] text-muted-foreground">{ayuda}</div>
          {error && <div className="mt-1.5 text-xs text-destructive">{error}</div>}
        </div>
        <div className="flex shrink-0 flex-col gap-1.5">
          <button type="button" disabled={guardando} onClick={() => void confirmar()}
            className="h-8 min-w-28 px-3 rounded-md bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 text-sm disabled:opacity-40">
            {usado ? `Aplicar ${numeroPago(usado.id)}` : editando ? "Guardar" : "Confirmar"}
          </button>
          <button type="button" onClick={onCancel} className="h-8 min-w-28 px-3 rounded-md border border-zinc-300 dark:border-zinc-600 text-sm">
            {modo.tipo === "facturas" ? "Limpiar" : "Cancelar"}
          </button>
        </div>
      </div>
    </div>
  );
}
