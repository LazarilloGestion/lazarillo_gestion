"use client";

import { ChevronLeft } from "lucide-react";
import { useFetchQuery } from "@/hooks/use-fetch-query";
import { saldo, type ComprobanteImpago } from "@/lib/impagas/clasificar";
import type { FacturaLeida } from "@/lib/facturas/leer-db";

// Ver una factura desde Impagas en el celu (Diego 28/10/2026): solo lectura, con el mismo
// contenido que "Ver factura" del Panel (renglones, percepciones, total) y sus pagos.

const $ = (n: number) => "$ " + n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dmy = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
const fmtCant = (n: number) => n.toLocaleString("es-AR", { maximumFractionDigits: 3 });

export function FacturaVerMovil({ imp, onVolver }: { imp: ComprobanteImpago; onVolver: () => void }) {
  const q = new URLSearchParams({ pdvId: String(imp.pdvId), comprobante: imp.comprobante, codPro: imp.codPro });
  const { data: busca, isLoading: buscando, error: errBusca } = useFetchQuery<{ rowId: string }>(["factura-buscar", imp.id], `/api/facturas/buscar?${q.toString()}`);
  const { data: leida, isLoading: leyendo } = useFetchQuery<FacturaLeida | { noEsFactura: true }>(
    ["factura", busca?.rowId ?? null], busca?.rowId ? `/api/facturas/${encodeURIComponent(busca.rowId)}` : null);
  const f = leida && "factura" in leida ? leida.factura : null;
  const iva = f ? f.registros.reduce((s, r) => s + Math.round(r.neto * r.alicuota) / 100, 0) : 0;
  const neto = f ? f.registros.reduce((s, r) => s + r.neto, 0) : 0;

  return (
    <div className="pb-6">
      <button type="button" onClick={onVolver} className="mb-2 flex items-center gap-1 text-[14px] text-sky-700"><ChevronLeft className="size-4" />Impagas</button>
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 p-4">
        <b className="block text-[17px]">{imp.proveedor}</b>
        <div className="text-[13px] text-zinc-500">
          {f ? `${f.tipo === "Ticket" ? "Tic" : f.tipo} ${f.prefijo.padStart(4, "0")}-${f.numero.padStart(8, "0")}` : imp.comprobante} · {dmy(imp.fecha)}
          {leida && "origen" in leida ? ` · ${leida.origen === "lazarillo" ? "cargada en Lazarillo" : "de MaxiRest"}` : ""}
        </div>
        {f?.observacion && <div className="mt-1 text-[13px] text-zinc-600 dark:text-zinc-300">{f.observacion}</div>}
      </div>

      {(buscando || leyendo) && <p className="py-6 text-center text-zinc-500">Cargando…</p>}
      {(errBusca || (leida && "noEsFactura" in leida)) && <p className="py-6 text-center text-zinc-500">No se pudo abrir el detalle de esta factura.</p>}

      {f && (
        <>
          <div className="mt-3">
            {f.registros.map((r, i) => (
              <div key={i} className="flex justify-between gap-3 border-b border-zinc-100 dark:border-zinc-800 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate text-[15px]">{r.nombre}</span>
                  <span className="text-[12px] text-zinc-500">
                    {r.tipo === "insumo" && r.cantidad ? `${fmtCant(r.cantidad)} ${r.medida ?? ""} · ` : ""}IVA {r.alicuota}%
                  </span>
                </span>
                <b className="shrink-0 tabular-nums">{$(r.neto)}</b>
              </div>
            ))}
          </div>
          <div className="mt-2 space-y-1 text-[14px]">
            <div className="flex justify-between text-zinc-500"><span>Neto</span><span className="tabular-nums">{$(neto)}</span></div>
            <div className="flex justify-between text-zinc-500"><span>IVA</span><span className="tabular-nums">{$(iva)}</span></div>
            {f.percepciones.filter((p) => p.importe).map((p, i) => (
              <div key={i} className="flex justify-between text-zinc-500"><span>{p.tipo}</span><span className="tabular-nums">{$(p.importe)}</span></div>
            ))}
            <div className="flex justify-between pt-1 text-[16px] font-bold"><span>Total</span><span className="tabular-nums">{$(imp.total)}</span></div>
          </div>
        </>
      )}

      <div className="mt-4 rounded-2xl border border-zinc-200 dark:border-zinc-700 p-4">
        <b>Pagos</b>
        {imp.pagos.length ? imp.pagos.map((p, i) => (
          <div key={i} className="flex justify-between py-1.5 text-[14px]"><span>{dmy(p.fecha)} · {p.medio ?? "—"}{p.orden ? ` · OP ${p.orden}` : ""}</span><span className="tabular-nums">{$(p.importe)}</span></div>
        )) : <p className="pt-1 text-[13px] text-zinc-500">Sin pagos.</p>}
        <div className="mt-1 flex justify-between border-t border-zinc-100 dark:border-zinc-800 pt-2 font-bold text-red-600"><span>Saldo</span><span className="tabular-nums">{$(saldo(imp))}</span></div>
      </div>
    </div>
  );
}
