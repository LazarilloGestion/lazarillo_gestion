"use client";

import { Fragment, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { SearchInput } from "@/components/ui/search-input";
import { Spinner } from "@/components/ui/spinner";
import { useFetchQuery } from "@/hooks/use-fetch-query";
import { cn } from "@/lib/utils";
import {
  MOTIVO_TITULO, agrupar, dias, filtrar, fmtComprobante, fmtFecha, fmtMillones, fmtPesos, motivo,
  saldo, separar, sumaSaldos, tramoAntiguedad,
  type ComprobanteImpago, type GrupoProveedor, type ImpagasResponse, type Motivo, type Orden,
} from "@/lib/impagas/clasificar";
import { CuentaCorrientePanel } from "./cuenta-corriente-panel";

export interface OpcionPdv { id: number; label: string }

export const impagasQueryKey = (pdvId: number | undefined) => ["impagas", pdvId];

const TRAMO_CLS = {
  reciente: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
  media: "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  vieja: "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300",
} as const;

function Antiguedad({ fecha, hoy }: { fecha: string; hoy: Date }) {
  const d = dias(fecha, hoy);
  return (
    <span className={cn("inline-block rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums", TRAMO_CLS[tramoAntiguedad(d)])}>
      {d} d
    </span>
  );
}

function Boton({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="h-7 px-2.5 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs text-zinc-700 dark:text-zinc-200 hover:border-zinc-400 dark:hover:border-zinc-500 disabled:opacity-40 whitespace-nowrap"
    >
      {children}
    </button>
  );
}

function Tarjeta({ titulo, valor, sub, activa, onClick, apagada }: {
  titulo: string; valor: string; sub: string; activa?: boolean; onClick?: () => void; apagada?: boolean;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "text-left rounded-xl border px-4 py-3 transition-colors",
        activa ? "border-zinc-900 dark:border-white ring-1 ring-zinc-900 dark:ring-white" : "border-zinc-200 dark:border-zinc-700",
        onClick && "hover:border-zinc-400 dark:hover:border-zinc-500",
        apagada && "opacity-50"
      )}
    >
      <div className="text-xs text-muted-foreground">{titulo}</div>
      <div className="text-xl font-semibold tabular-nums mt-0.5">{valor}</div>
      <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>
    </Tag>
  );
}

interface Props {
  open: boolean;
  onClose: () => void;
  pdvs: OpcionPdv[];
  pdvInicial: number | undefined;
}

// El contenido se monta solo con el modal abierto (Radix desmonta al cerrar):
// cada apertura arranca con el buscador vacío, en Impagas y en el PDV del panel.
export function ImpagasModal({ open, onClose, pdvs, pdvInicial }: Props) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        showCloseButton={false}
        className="w-[calc(100vw-2rem)] sm:w-[94vw] max-w-[94vw] sm:max-w-[1150px] h-[88vh] flex flex-col gap-0 p-0 overflow-hidden"
      >
        <ImpagasContenido onClose={onClose} pdvs={pdvs} pdvInicial={pdvInicial} />
      </DialogContent>
    </Dialog>
  );
}

function ImpagasContenido({ onClose, pdvs, pdvInicial }: Omit<Props, "open">) {
  const queryClient = useQueryClient();
  const [pdvId, setPdvId] = useState<number | undefined>(pdvInicial ?? pdvs[0]?.id);
  const [tab, setTab] = useState<"I" | "E">("I");
  const [orden, setOrden] = useState<Orden>("saldo");
  const [solo60, setSolo60] = useState(false);
  const [q, setQ] = useState("");
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  const [ctaCte, setCtaCte] = useState<{ codPro: string; resaltado: string } | null>(null);
  const [guardando, setGuardando] = useState(false);

  const key = impagasQueryKey(pdvId);
  const { data, isLoading, error } = useFetchQuery<ImpagasResponse>(
    key, pdvId ? `/api/impagas?pdvId=${pdvId}` : null
  );
  const hoy = useMemo(() => new Date(), []);
  const todas = useMemo(() => data?.data ?? [], [data]);
  const { impagas, excluidas } = useMemo(() => separar(todas), [todas]);
  const lista = useMemo(
    () => filtrar(tab === "I" ? impagas : excluidas, { q, solo60: tab === "I" && solo60, hoy }),
    [tab, impagas, excluidas, q, solo60, hoy]
  );

  function toggle(k: string) {
    setAbiertos((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  }

  // Aplica el cambio en pantalla al toque y después refresca desde la base.
  async function mutar(
    url: string, method: string, body: unknown,
    local: (f: ComprobanteImpago) => ComprobanteImpago, ok: string
  ) {
    setGuardando(true);
    const previo = queryClient.getQueryData<ImpagasResponse>(key);
    if (previo) queryClient.setQueryData<ImpagasResponse>(key, { ...previo, data: previo.data.map(local) });
    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success(ok);
    } catch (e) {
      console.error(e);
      if (previo) queryClient.setQueryData(key, previo);
      toast.error("No se pudo guardar. Intentá de nuevo.");
    } finally {
      setGuardando(false);
      queryClient.invalidateQueries({ queryKey: ["impagas"] });
    }
  }

  const forzar = (items: ComprobanteImpago[], si: boolean) => {
    const ids = new Set(items.map((f) => f.id));
    return mutar(
      "/api/impagas/forzadas", si ? "POST" : "DELETE",
      { items: items.map((f) => ({ pdvId: f.pdvId, comprobante: f.comprobante, codPro: f.codPro })) },
      (f) => (ids.has(f.id) ? { ...f, forzada: si } : f),
      si ? (items.length > 1 ? "Pasadas a Impagas" : "Pasada a Impagas") : "Vuelve a Excluidas"
    );
  };

  const pagoAutomatico = (g: GrupoProveedor, si: boolean) => {
    if (!g.proveedorId) return;
    return mutar(
      "/api/impagas/pago-automatico", "PATCH", { proveedorId: g.proveedorId, pagoAutomatico: si },
      (f) => (f.codPro === g.codPro ? { ...f, pagoAutomatico: si, forzada: si ? false : f.forzada } : f),
      si ? `${g.proveedor}: pago automático → pasó a Excluidas` : `${g.proveedor}: vuelve a Impagas`
    );
  };

  const filaComprobante = (f: ComprobanteImpago, accion: React.ReactNode) => (
    <tr key={f.id} className="border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/40">
      <td className="py-2 pl-10 pr-3">
        <button
          type="button"
          onClick={() => setCtaCte({ codPro: f.codPro, resaltado: f.id })}
          className="font-medium text-sky-700 dark:text-sky-400 hover:underline tabular-nums"
        >
          {fmtComprobante(f.comprobante)}
        </button>
        <span className="text-muted-foreground"> · {fmtFecha(f.fecha)}</span>
        {f.pagado !== 0 && (
          <span className="ml-2 rounded px-1.5 py-0.5 text-[10px] bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
            parcial · pagado {fmtPesos(f.pagado)}
          </span>
        )}
        {f.forzada && (
          <span className="ml-2 rounded px-1.5 py-0.5 text-[10px] bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300">pasada a mano</span>
        )}
        {f.conceptos && <div className="text-[11px] text-muted-foreground truncate max-w-[32rem]">{f.conceptos}</div>}
      </td>
      <td className="py-2 px-3 text-right tabular-nums text-muted-foreground hidden sm:table-cell">{fmtPesos(f.total)}</td>
      <td className="py-2 px-3 text-right tabular-nums">{fmtPesos(saldo(f))}</td>
      <td className="py-2 px-3"><Antiguedad fecha={f.fecha} hoy={hoy} /></td>
      <td className="py-2 px-3 hidden sm:table-cell">{accion}</td>
    </tr>
  );

  const filaProveedor = (g: GrupoProveedor, k: string, etiqueta: React.ReactNode, accion: React.ReactNode) => {
    const abierto = abiertos.has(k) || !!q.trim();
    return (
      <tr key={k} onClick={() => toggle(k)} className="border-b border-zinc-100 dark:border-zinc-800 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
        <td className="py-2.5 px-3">
          <span className="inline-flex items-center gap-1.5">
            {abierto ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
            <span className="font-semibold">{g.proveedor}</span>
            {etiqueta}
            <span className="text-xs text-muted-foreground">{g.items.length}</span>
          </span>
        </td>
        <td className="hidden sm:table-cell" />
        <td className="py-2.5 px-3 text-right font-semibold tabular-nums">{fmtPesos(g.saldo)}</td>
        <td className="py-2.5 px-3"><Antiguedad fecha={g.masVieja} hoy={hoy} /></td>
        <td className="py-2.5 px-3 hidden sm:table-cell">{accion}</td>
      </tr>
    );
  };

  const chip = (t: string) => (
    <span className="rounded px-1.5 py-0.5 text-[10px] bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{t}</span>
  );

  function cuerpoImpagas() {
    return agrupar(lista, orden).map((g) => {
      const k = `I${g.codPro}`;
      const todasForzadas = g.items.every((f) => f.forzada);
      const accion = todasForzadas
        ? <Boton disabled={guardando} onClick={() => forzar(g.items, false)}>Volver a excluir</Boton>
        : g.proveedorId
          ? <Boton disabled={guardando} onClick={() => pagoAutomatico(g, true)}>Marcar pago automático</Boton>
          : null;
      return (
        <Fragment key={k}>
          {filaProveedor(g, k, null, accion)}
          {(abiertos.has(k) || !!q.trim()) && g.items.map((f) =>
            filaComprobante(f, f.forzada ? <Boton disabled={guardando} onClick={() => forzar([f], false)}>Volver a excluir</Boton> : null)
          )}
        </Fragment>
      );
    });
  }

  function cuerpoExcluidas() {
    const motivos: Motivo[] = ["rubro", "auto", "nc"];
    return motivos.map((m) => {
      const l = lista.filter((f) => motivo(f) === m);
      if (!l.length) return null;
      return (
        <Fragment key={m}>
          <tr className="bg-zinc-100 dark:bg-zinc-800">
            <td colSpan={5} className="py-2 px-3 text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-300">
              {MOTIVO_TITULO[m]} · {l.length} comprobante{l.length !== 1 ? "s" : ""} · {fmtPesos(sumaSaldos(l))}
            </td>
          </tr>
          {agrupar(l, orden).map((g) => {
            const k = `E${m}${g.codPro}`;
            const etiqueta = m === "rubro"
              ? chip([...new Set(g.items.map((f) => f.rubroOculto))].join(", "))
              : m === "auto" ? chip("pago automático") : chip("nota de crédito");
            const accion = m === "auto"
              ? <Boton disabled={guardando} onClick={() => pagoAutomatico(g, false)}>Quitar pago automático</Boton>
              : <Boton disabled={guardando} onClick={() => forzar(g.items, true)}>Pasar todas a impagas</Boton>;
            return (
              <Fragment key={k}>
                {filaProveedor(g, k, etiqueta, accion)}
                {(abiertos.has(k) || !!q.trim()) && g.items.map((f) =>
                  filaComprobante(f, m === "auto" ? null : <Boton disabled={guardando} onClick={() => forzar([f], true)}>Pasar a impagas</Boton>)
                )}
              </Fragment>
            );
          })}
        </Fragment>
      );
    });
  }

  function tarjetas() {
    if (tab === "I") {
      const l60 = impagas.filter((f) => dias(f.fecha, hoy) <= 60);
      const l120 = impagas.filter((f) => dias(f.fecha, hoy) > 120);
      return (
        <>
          <Tarjeta
            titulo={`0 – 60 días · ${solo60 ? "filtrando (tocá para quitar)" : "tocá para filtrar"}`}
            valor={fmtMillones(sumaSaldos(l60))} sub={`${l60.length} comprobantes`}
            activa={solo60} onClick={() => setSolo60((v) => !v)}
          />
          <Tarjeta
            titulo="Saldo total" valor={fmtMillones(sumaSaldos(impagas))}
            sub={`${impagas.length} comprobantes · ${new Set(impagas.map((f) => f.codPro)).size} proveedores`}
          />
          <Tarjeta titulo="Más de 120 días" valor={fmtMillones(sumaSaldos(l120))} sub={`${l120.length} comprobantes`} />
        </>
      );
    }
    const por = (m: Motivo) => excluidas.filter((f) => motivo(f) === m);
    const r = por("rubro"), a = por("auto"), n = por("nc");
    const forzadas = todas.filter((f) => f.forzada).length;
    return (
      <>
        <Tarjeta titulo="Por rubro oculto" valor={fmtMillones(sumaSaldos(r))} sub={`${r.length} · según "Rubros visibles en panel"`} />
        <Tarjeta
          titulo="Por pago automático" valor={fmtMillones(sumaSaldos(a))}
          sub={`${a.length} · ${new Set(a.map((f) => f.codPro)).size} proveedores marcados`}
        />
        {n.length > 0 && (
          <Tarjeta titulo="Notas de crédito" valor={fmtMillones(sumaSaldos(n))} sub={`${n.length} · restan deuda, no se pagan`} />
        )}
        <Tarjeta
          titulo="Pasadas a mano a impagas" valor={String(forzadas)}
          sub="se pueden volver a excluir" apagada={forzadas === 0}
        />
      </>
    );
  }

  const nCols = tab === "E" && excluidas.some((f) => motivo(f) === "nc") ? 4 : 3;
  const vacio = tab === "I" ? "No hay comprobantes impagos con este filtro." : "No hay comprobantes excluidos en este PDV.";

  return (
    <>
        {/* Encabezado: título · PDV · pestañas … buscador · cerrar */}
        <div className="px-5 pt-4 pb-3 flex flex-wrap items-center gap-3 shrink-0">
          <DialogTitle className="text-lg font-semibold">Comprobantes impagos</DialogTitle>
          <select
            value={pdvId ?? ""}
            onChange={(e) => { setPdvId(Number(e.target.value)); setAbiertos(new Set()); setCtaCte(null); }}
            className="h-8 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 text-sm"
          >
            {pdvs.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          <div className="flex rounded-lg bg-zinc-100 dark:bg-zinc-800 p-0.5">
            {([["I", `Impagas ${impagas.length}`], ["E", `Excluidas ${excluidas.length}`]] as const).map(([t, label]) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={cn(
                  "h-7 px-3 rounded-md text-sm transition-colors",
                  tab === t ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <SearchInput value={q} onChange={setQ} placeholder="Buscar proveedor o comprobante…" className="w-64" />
            <button type="button" onClick={onClose} aria-label="Cerrar" className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className={cn("px-5 grid grid-cols-1 gap-3 shrink-0", nCols === 4 ? "sm:grid-cols-4" : "sm:grid-cols-3")}>{tarjetas()}</div>

        <div className="px-5 py-3 flex items-center gap-2 text-sm shrink-0">
          <span className="text-muted-foreground">Ordenar por</span>
          <div className="flex rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
            {([["saldo", "Saldo"], ["antiguedad", "Antigüedad"]] as const).map(([o, label]) => (
              <button
                key={o}
                type="button"
                onClick={() => setOrden(o)}
                className={cn("h-7 px-3", orden === o ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" : "text-zinc-600 dark:text-zinc-300")}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="relative flex-1 min-h-0 border-t border-zinc-200 dark:border-zinc-700">
          <div className="h-full overflow-y-auto">
            {isLoading && <div className="py-12 flex justify-center"><Spinner size="lg" /></div>}
            {error && <div className="py-12 text-center text-sm text-destructive">Error al cargar los comprobantes.</div>}
            {!isLoading && !error && lista.length === 0 && (
              <div className="py-12 text-center text-sm text-muted-foreground">{vacio}</div>
            )}
            {!isLoading && !error && lista.length > 0 && (
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-white dark:bg-zinc-900">
                  <tr className="border-b border-zinc-200 dark:border-zinc-700 text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 px-3 text-left font-semibold w-[46%]">{tab === "I" ? "Proveedor / comprobante" : "Proveedor / motivo"}</th>
                    <th className="py-2 px-3 text-right font-semibold hidden sm:table-cell">Total</th>
                    <th className="py-2 px-3 text-right font-semibold">Saldo</th>
                    <th className="py-2 px-3 text-left font-semibold">Antigüedad</th>
                    <th className="py-2 px-3 text-left font-semibold hidden sm:table-cell">Acción</th>
                  </tr>
                </thead>
                <tbody>{tab === "I" ? cuerpoImpagas() : cuerpoExcluidas()}</tbody>
              </table>
            )}
          </div>

          {ctaCte && (
            <CuentaCorrientePanel
              comprobantes={todas.filter((f) => f.codPro === ctaCte.codPro)}
              resaltado={ctaCte.resaltado}
              pdvLabel={pdvs.find((p) => p.id === pdvId)?.label ?? ""}
              onClose={() => setCtaCte(null)}
            />
          )}
        </div>
    </>
  );
}
