"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Search, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { useFetchQuery } from "@/hooks/use-fetch-query";
import { cn } from "@/lib/utils";
import { fmtComprobante, fmtPesos } from "@/lib/impagas/clasificar";
import { ETIQUETA_ESTADO, totalesCtaCte, type EstadoPago } from "@/lib/cta-cte/estado";
import { OpMaxirestModal } from "@/components/impagas/op-maxirest-modal";

// Cuenta corriente del proveedor — SOLO LECTURA (punto 4, Etapa 3), con el
// diseño de ModalCtaCte_etapa3: buscador de proveedor + A cuenta / Saldo arriba;
// a la izquierda sus facturas (todos los PDV) con Mes / Año / Histórico, buscador
// de comprobante y orden por títulos; a la derecha los pagos de la factura
// tocada (o todos). Lo de la etapa 4 (cargar, editar, repetir) va en gris.

interface PagoCtaCte { fecha: string; importe: number; medio: string | null; orden: string | null }
interface FacturaCtaCte {
  pdvId: number; pdv: string; comprobante: string; fecha: string; total: number; pagado: number; conceptos: string;
  rowId: string | null; solo80: boolean; estado: EstadoPago | null; pagos: PagoCtaCte[];
}
interface CtaCteResp {
  codPro: string; proveedor: string; razon: string | null; cuit: string | null;
  pagoAutomatico: boolean; desdeCobertura: string; facturas: FacturaCtaCte[];
}

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const PROXIMAMENTE = "Próximamente — disponible en la etapa 4 (carga de pagos y comprobantes)";
const dmy = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}` : "—");
const claveF = (f: { pdvId: number; comprobante: string }) => `${f.pdvId}|${f.comprobante}`;

// Colores sólidos del mockup.
const BADGE: Record<EstadoPago, string> = {
  paga: "bg-[#159457] text-white",
  parcial: "bg-[#e08900] text-white",
  impaga: "bg-[#c62828] text-white",
  auto: "bg-zinc-400 text-white",
  nc: "bg-sky-600 text-white",
  "sin-datos": "bg-zinc-200 text-zinc-600",
};
const RANK: Record<string, number> = { impaga: 0, parcial: 1, auto: 2, "sin-datos": 3, nc: 4, paga: 5, "": 6 };

type Periodo = "mes" | "anio" | "hist";
type CampoOrden = "fecha" | "comp" | "importe" | "estado";

function Gris({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span title={PROXIMAMENTE} className={cn("inline-flex opacity-50 cursor-not-allowed", className)}>{children}</span>;
}

// Buscador de proveedor (cambiar de proveedor sin cerrar).
function BuscadorProveedor({ valor, onElegir }: { valor: string; onElegir: (codPro: string) => void }) {
  const [texto, setTexto] = useState<string | null>(null); // null = muestra el proveedor actual
  const [q, setQ] = useState("");
  useEffect(() => { const t = setTimeout(() => setQ((texto ?? "").trim()), 250); return () => clearTimeout(t); }, [texto]);
  const { data } = useFetchQuery<{ proveedores: { codPro: string; nombre: string; facturas: number }[] }>(
    ["cta-cte-prov", q], `/api/cta-cte/proveedores?q=${encodeURIComponent(q)}`, { enabled: texto !== null && texto !== valor && q.length >= 2 },
  );
  const buscando = texto !== null && texto !== valor && q.length >= 2;
  const opciones = buscando ? data?.proveedores ?? [] : [];
  const elegir = (c: string) => { setTexto(null); onElegir(c); };
  return (
    <div className="relative w-60">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
      <input
        value={texto ?? valor}
        placeholder="Buscar proveedor..."
        onFocus={(e) => { setTexto(valor); e.currentTarget.select(); }}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && opciones[0]) elegir(opciones[0].codPro); if (e.key === "Escape") { e.stopPropagation(); setTexto(null); } }}
        onBlur={() => setTimeout(() => setTexto(null), 180)}
        className="h-9 w-full rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 pl-8 pr-2 text-sm outline-none focus:border-sky-500"
      />
      {opciones.length > 0 && (
        <div className="absolute left-0 right-0 top-[105%] z-50 max-h-60 overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg">
          {opciones.map((o) => (
            <button key={o.codPro} type="button" onMouseDown={() => elegir(o.codPro)}
              className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-sky-50 dark:hover:bg-sky-950/40 border-b border-zinc-100 dark:border-zinc-800">
              <span className="truncate">{o.nombre}</span><span className="text-[11px] text-muted-foreground">{o.facturas} fc.</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function CtaCteContenido({ codPro: codInicial, resaltado, onCerrar, titulo }: {
  codPro: string;
  resaltado?: { pdvId: number; comprobante: string } | null; // factura a dejar elegida
  onCerrar?: () => void;
  titulo?: (nodo: React.ReactNode) => React.ReactNode;       // el modal lo envuelve en DialogTitle
}) {
  const [codPro, setCodPro] = useState(codInicial);
  const { data, isLoading, isError } = useFetchQuery<CtaCteResp>(["cta-cte", codPro], `/api/cta-cte?codPro=${encodeURIComponent(codPro)}`);
  const [sel, setSel] = useState<string | null>(resaltado ? claveF(resaltado) : null);
  const [per, setPer] = useState<Periodo>("hist");
  const hoy = new Date();
  const [mes, setMes] = useState(hoy.getMonth());
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [orden, setOrden] = useState<{ campo: CampoOrden; dir: 1 | -1 }>({ campo: "fecha", dir: 1 });
  const [busca, setBusca] = useState("");
  const [opMx, setOpMx] = useState<{ pdvId: number; orden: string; fecha: string } | null>(null);
  const filaSel = useRef<HTMLDivElement | null>(null);

  const facturas = useMemo(() => data?.facturas ?? [], [data]);
  const fact = facturas.find((f) => claveF(f) === sel) ?? null;
  const tot = useMemo(() => totalesCtaCte(facturas), [facturas]);

  const enPeriodo = (iso: string) =>
    per === "hist" || (per === "anio" ? iso.startsWith(String(anio)) : iso.startsWith(`${anio}-${String(mes + 1).padStart(2, "0")}`));
  const mover = (d: number) => {
    if (per === "anio") { setAnio((a) => a + d); return; }
    let n = mes + d, a = anio;
    if (n < 0) { n = 11; a--; } else if (n > 11) { n = 0; a++; }
    setMes(n); setAnio(a);
  };
  const clickOrden = (campo: CampoOrden) => setOrden((o) => (o.campo === campo ? { campo, dir: (-o.dir) as 1 | -1 } : { campo, dir: 1 }));
  const flecha = (c: CampoOrden) => (orden.campo === c ? (orden.dir === 1 ? " ▲" : " ▼") : "");
  const val = (f: FacturaCtaCte): string | number =>
    orden.campo === "importe" ? f.total : orden.campo === "estado" ? RANK[f.estado ?? ""] : orden.campo === "comp" ? f.comprobante : f.fecha;
  const coincide = (f: FacturaCtaCte) => {
    const t = busca.trim().toLowerCase().replace(/[\s-]/g, "");
    return !t || f.comprobante.toLowerCase().includes(t) || fmtComprobante(f.comprobante).toLowerCase().replace(/[\s-]/g, "").includes(t);
  };
  const visibles = facturas.filter((f) => enPeriodo(f.fecha) && coincide(f))
    .sort((a, b) => (val(a) < val(b) ? -1 : val(a) > val(b) ? 1 : 0) * orden.dir);

  // Pagos de la factura tocada, o todos los del proveedor (más nuevo primero).
  const pagosLista = fact
    ? fact.pagos.map((p) => ({ ...p, f: fact }))
    : facturas.flatMap((f) => f.pagos.map((p) => ({ ...p, f }))).sort((a, b) => b.fecha.localeCompare(a.fecha));

  useEffect(() => { filaSel.current?.scrollIntoView({ block: "center" }); }, [data]);

  const cambiarProv = (c: string) => { setCodPro(c); setSel(null); setBusca(""); };
  const tituloNodo = <span className="text-[19px] font-normal whitespace-nowrap">— cuenta corriente</span>;

  return (
    <div className="flex flex-col h-full min-h-0 px-6 pt-5 pb-4">
      {/* ===== encabezado ===== */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 shrink-0">
        <BuscadorProveedor valor={data?.proveedor ?? ""} onElegir={cambiarProv} />
        {titulo ? titulo(tituloNodo) : tituloNodo}
        {data && (
          <>
            <span className="text-[13.5px] text-zinc-600 dark:text-zinc-300">A cuenta <b className="text-zinc-400">—</b></span>
            <span className="text-[13.5px] text-zinc-600 dark:text-zinc-300">
              Saldo <b className={tot.saldo > 0.5 ? "text-[#c62828]" : "text-[#159457]"}>{fmtPesos(tot.saldo)}</b>
            </span>
            {data.pagoAutomatico && <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold bg-zinc-100 text-zinc-600">pago automático</span>}
          </>
        )}
        {onCerrar && (
          <button type="button" onClick={onCerrar} aria-label="Cerrar" className="ml-auto text-zinc-400 hover:text-zinc-700"><X className="h-5 w-5" /></button>
        )}
      </div>

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center"><Spinner size="lg" /></div>
      ) : isError || !data ? (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">No se pudo leer la cuenta corriente.</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[1.05fr_1fr] gap-6 mt-4 flex-1 min-h-0">
          {/* ===== facturas ===== */}
          <div className="flex flex-col min-h-0">
            <div className="flex flex-wrap items-center gap-2 mb-2.5 shrink-0">
              <span className="text-[11.5px] font-bold uppercase tracking-wide text-zinc-500">Facturas</span>
              {per !== "hist" && (
                <>
                  <button type="button" onClick={() => mover(-1)} className="rounded-lg border border-zinc-200 dark:border-zinc-700 px-2.5 text-[13px] text-zinc-600">‹</button>
                  <span className="min-w-[86px] text-center text-[12.5px] font-bold">{per === "anio" ? anio : `${MESES[mes]} ${anio}`}</span>
                  <button type="button" onClick={() => mover(1)} className="rounded-lg border border-zinc-200 dark:border-zinc-700 px-2.5 text-[13px] text-zinc-600">›</button>
                </>
              )}
              <span className="ml-auto inline-flex overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700">
                {([["mes", "Mes"], ["anio", "Año"], ["hist", "Histórico"]] as [Periodo, string][]).map(([k, t]) => (
                  <button key={k} type="button" onClick={() => setPer(k)}
                    className={cn("px-2.5 py-1 text-[11.5px] font-bold", per === k ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" : "text-zinc-500")}>{t}</button>
                ))}
              </span>
            </div>
            <div className="relative mb-2 shrink-0">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar comprobante (tipo, prefijo o número)..."
                className="h-9 w-full rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 pl-8 pr-2 text-[13px] outline-none focus:border-sky-500" />
            </div>
            <div className="flex gap-2.5 px-3 pb-1.5 text-[10.5px] font-bold text-zinc-500 shrink-0">
              <span className="w-[13px]" />
              <button type="button" onClick={() => clickOrden("fecha")} className="w-[62px] text-left">FECHA{flecha("fecha")}</button>
              <button type="button" onClick={() => clickOrden("comp")} className="flex-1 text-left">COMPROBANTE{flecha("comp")}</button>
              <button type="button" onClick={() => clickOrden("importe")} className="w-[110px] text-right">IMPORTE{flecha("importe")}</button>
              <button type="button" onClick={() => clickOrden("estado")} className="w-[78px] text-right">ESTADO{flecha("estado")}</button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto">
              {visibles.map((f) => {
                const on = fact != null && claveF(f) === claveF(fact);
                return (
                  <div key={claveF(f)} ref={on ? filaSel : undefined} onClick={() => setSel(on ? null : claveF(f))}
                    className={cn("flex items-center gap-2.5 px-3 py-2.5 rounded-lg cursor-pointer border-b border-zinc-100 dark:border-zinc-800",
                      on ? "bg-[#eef6fb] dark:bg-sky-950/40" : "hover:bg-zinc-50 dark:hover:bg-zinc-800/40")}>
                    {f.estado && f.estado !== "paga" ? <Gris><input type="checkbox" disabled className="h-[13px] w-[13px]" /></Gris> : <span className="w-[13px]" />}
                    <span className="w-[62px] text-[12.5px] text-zinc-600 dark:text-zinc-300 tabular-nums">{dmy(f.fecha)}</span>
                    <span className="flex-1 min-w-0 text-[13px]">
                      <span className="tabular-nums">{fmtComprobante(f.comprobante)}</span>
                      {f.solo80 && <span className="ml-1.5 text-[10px] text-muted-foreground" title="El pago está en el informe 80 pero la factura no está en el 14">solo 80</span>}
                      <span className="block truncate text-[11.5px] text-zinc-500" title={f.conceptos}>{f.pdv}{f.conceptos ? ` · ${f.conceptos}` : ""}</span>
                    </span>
                    <span className="w-[110px] text-right text-[13px] font-semibold tabular-nums">{fmtPesos(f.total)}</span>
                    <span className="w-[78px] text-right">
                      {f.estado ? (
                        <span title={f.estado === "sin-datos" ? `El informe 80 no cubre antes del ${dmy(data.desdeCobertura)}` : undefined}
                          className={cn("rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase whitespace-nowrap", BADGE[f.estado])}>
                          {f.estado === "sin-datos" ? "s/datos" : f.estado === "auto" ? "automát." : ETIQUETA_ESTADO[f.estado]}
                        </span>
                      ) : <span className="text-[11px] text-muted-foreground">—</span>}
                    </span>
                  </div>
                );
              })}
              {visibles.length === 0 && (
                <p className="px-3 py-2.5 text-[12.5px] text-zinc-500">
                  {busca.trim() ? "Ningún comprobante coincide con la búsqueda." : "Sin facturas en este período — probá Año o Histórico."}
                </p>
              )}
            </div>
          </div>

          {/* ===== pagos ===== */}
          <div className="flex flex-col min-h-0">
            <div className="flex flex-wrap items-center gap-2.5 mb-2 shrink-0">
              <span className="text-[11.5px] font-bold uppercase tracking-wide text-zinc-500">
                {fact ? `Pagos de ${fmtComprobante(fact.comprobante)}` : "Todos los pagos del proveedor"}
              </span>
              <span className="ml-auto flex gap-2.5">
                {fact && <Gris><button type="button" disabled className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-semibold">✎ Editar {fmtComprobante(fact.comprobante)}</button></Gris>}
                <Gris><button type="button" disabled className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-semibold">⟳ Repetir</button></Gris>
                <Gris><button type="button" disabled className="rounded-lg bg-zinc-900 px-4 py-1.5 text-[13px] font-semibold text-white">+ Cargar pago</button></Gris>
              </span>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto">
              {pagosLista.length === 0 && <p className="py-2 text-[13px] text-zinc-500">Sin pagos registrados.</p>}
              {pagosLista.map((p, i) => (
                <div key={`${claveF(p.f)}-${i}`} className="mb-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-[#fafaf8] dark:bg-zinc-900/60 px-3.5 py-2.5">
                  <div className="flex items-center justify-between text-[13.5px]">
                    <b className="tabular-nums">{dmy(p.fecha)} · {fmtPesos(p.importe)}</b>
                    <Gris className="gap-3 items-center"><span className="text-zinc-400">✎</span><span className="text-[11.5px] text-zinc-500">eliminar</span></Gris>
                  </div>
                  {!fact && <div className="mt-0.5 text-[12px] text-zinc-500">a {fmtComprobante(p.f.comprobante)} · {dmy(p.f.fecha)}</div>}
                  <div className="mt-0.5 text-[12.5px] text-zinc-600 dark:text-zinc-300">
                    {p.medio ?? "—"}
                    {p.orden && (
                      <button type="button" onClick={() => setOpMx({ pdvId: p.f.pdvId, orden: p.orden!, fecha: p.fecha })}
                        className="ml-1.5 text-[#0d6fa8] hover:underline">· OP {p.orden} ›</button>
                    )}
                    <span className="text-zinc-400"> · MaxiRest</span>
                  </div>
                  <div className="mt-0.5 text-[12.5px] text-[#0d6fa8]">Pagado por: <b>{p.f.pdv}</b></div>
                </div>
              ))}
              {fact && (fact.estado === "impaga" || fact.estado === "parcial") && (
                <div className="mb-2.5 rounded-xl border-[1.5px] border-[#f0c179] px-3.5 py-2 text-[13px] text-[#e08900]">
                  Saldo pendiente de esta factura: <b>{fmtPesos(fact.total - fact.pagado)}</b>
                </div>
              )}
              {fact && fact.estado === "paga" && (
                <div className="mb-2.5 flex items-center gap-1.5 rounded-xl border-[1.5px] border-[#bfe3cf] bg-[#f2faf5] px-3.5 py-2 text-[13px] font-semibold text-[#159457]">
                  <Check className="h-4 w-4" /> Factura paga
                </div>
              )}
              {fact && fact.estado && !["impaga", "parcial", "paga"].includes(fact.estado) && (
                <div className="mb-2.5 rounded-xl border border-zinc-200 px-3.5 py-2 text-[13px] text-zinc-600">
                  {fact.estado === "sin-datos" ? `Sin datos de pago: el informe 80 no cubre antes del ${dmy(data.desdeCobertura)}.`
                    : fact.estado === "auto" ? "Proveedor con pago automático: sin pago registrado no cuenta como deuda."
                    : "Nota de crédito."}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {opMx && (
        <OpMaxirestModal pdvId={opMx.pdvId} orden={opMx.orden} fecha={opMx.fecha}
          onCambiar={(fecha) => setOpMx({ ...opMx, fecha })} onCerrar={() => setOpMx(null)} />
      )}
    </div>
  );
}

// Modal propio (desde el proveedor de Detalle de compras o desde Impagas).
export function CtaCteModal({ codPro, resaltado, onCerrar }: {
  codPro: string; resaltado?: { pdvId: number; comprobante: string } | null; onCerrar: () => void;
}) {
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onCerrar(); }}>
      <DialogContent showCloseButton={false} onOpenAutoFocus={(e) => e.preventDefault()} className="w-[min(1180px,94vw)] max-w-[94vw] sm:max-w-[1180px] h-[min(90vh,820px)] flex flex-col gap-0 p-0 overflow-hidden">
        <CtaCteContenido codPro={codPro} resaltado={resaltado} onCerrar={onCerrar}
          titulo={(n) => <DialogTitle asChild>{n}</DialogTitle>} />
      </DialogContent>
    </Dialog>
  );
}

