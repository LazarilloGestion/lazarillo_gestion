"use client";

import { useEffect, useMemo, useState } from "react";
import { Copy, Check, Search, Tags, ChevronDown, Plus, Pencil, Trash2, Lock } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CODIGO_MIN_LAZARILLO, TIPOS_CONCEPTO, esPropio, proximoCodigoLazarillo } from "@/lib/conceptos/abm";
import { Spinner } from "@/components/ui/spinner";
import { Input } from "@/components/ui/input";
import { useFetchQuery } from "@/hooks/use-fetch-query";
import { cn } from "@/lib/utils";
import { rangosLibres, cantidadLibres, textoRango, libreDesde, MAX_CODIGO_CONCEPTO } from "@/lib/conceptos/codigos-libres";
import type { ConceptoMaestro } from "@/lib/render/db";

type Respuesta = { fuente: "render" | "panel"; conceptos: ConceptoMaestro[]; conRegistros: string[] | null; rubros: { codigo: string; nombre: string }[] };

type FormConcepto = { codigo: number | null; nombre: string; tipo: string; codRubro: string; imputacion: string };

// Alta / modificación de un concepto propio de Lazarillo (código desde 1000).
function FormularioConcepto({
  inicial,
  proximo,
  rubros,
  onCerrar,
  onGuardado,
}: {
  inicial: FormConcepto;
  proximo: number;
  rubros: { codigo: string; nombre: string }[];
  onCerrar: () => void;
  onGuardado: () => void;
}) {
  const [f, setF] = useState(inicial);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editando = inicial.codigo != null;
  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      const res = await fetch(editando ? `/api/conceptos/${inicial.codigo}` : "/api/conceptos", {
        method: editando ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: f.nombre, tipo: f.tipo, codRubro: f.codRubro, imputacion: f.imputacion }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) { setError(d?.error ?? "No se pudo guardar"); return; }
      toast.success(editando ? `Concepto ${inicial.codigo} actualizado` : `Concepto ${d?.codigo} creado`);
      onGuardado();
    } catch {
      setError("Error de red");
    } finally {
      setGuardando(false);
    }
  }
  const campo = "h-8 rounded-md border bg-background px-2 text-sm";
  return (
    <div className="mx-4 my-3 rounded-lg border border-sky-200 bg-sky-50/60 p-3 dark:border-sky-900 dark:bg-sky-950/20">
      <div className="mb-2 text-xs font-medium">
        {editando ? `Modificar concepto ${inicial.codigo}` : `Nuevo concepto de Lazarillo · código ${proximo}`}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">Nombre
          <Input autoFocus value={f.nombre} maxLength={60} onChange={(e) => setF({ ...f, nombre: e.target.value })} className="h-8 w-64" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">Tipo
          <select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })} className={campo}>
            {TIPOS_CONCEPTO.map((t) => <option key={t.valor} value={t.valor}>{t.etiqueta}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">Rubro
          <select value={f.codRubro} onChange={(e) => setF({ ...f, codRubro: e.target.value })} className={cn(campo, "w-56")}>
            <option value="">Elegí un rubro</option>
            {rubros.map((r) => <option key={r.codigo} value={r.codigo}>{r.codigo} · {r.nombre}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">Imputación
          <Input value={f.imputacion} maxLength={20} onChange={(e) => setF({ ...f, imputacion: e.target.value })} className="h-8 w-28" />
        </label>
        <div className="flex gap-2">
          <button type="button" onClick={onCerrar} disabled={guardando} className="h-8 rounded-md border px-3 text-xs hover:bg-muted">Cancelar</button>
          <button
            type="button"
            onClick={guardar}
            disabled={guardando || !f.nombre.trim() || !f.codRubro}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {guardando && <Spinner size="sm" className="text-primary-foreground" />}
            {editando ? "Guardar" : "Crear concepto"}
          </button>
        </div>
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  );
}

// Preferencias de esta pantalla guardadas en el navegador (qué quedó abierto).
function usePreferencia(clave: string, inicial: boolean): [boolean, (v: boolean) => void] {
  const [v, setV] = useState(inicial);
  useEffect(() => {
    try {
      const g = localStorage.getItem(clave);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- preferencia guardada en este navegador
      if (g != null) setV(g === "1");
    } catch { /* sin storage */ }
  }, [clave]);
  return [v, (n: boolean) => { setV(n); try { localStorage.setItem(clave, n ? "1" : "0"); } catch { /* sin storage */ } }];
}

const Flecha = ({ abierta }: { abierta: boolean }) => (
  <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", !abierta && "-rotate-90")} />
);

function CopiarCodigo({ codigo, grande = false }: { codigo: number; grande?: boolean }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      title="Copiar código"
      onClick={() => {
        navigator.clipboard?.writeText(String(codigo)).catch(() => {});
        setOk(true);
        setTimeout(() => setOk(false), 1200);
      }}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border bg-background tabular-nums hover:bg-muted",
        grande ? "h-9 px-3 text-lg font-semibold" : "h-7 px-2 text-sm"
      )}
    >
      {codigo}
      {ok ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground" />}
    </button>
  );
}

export default function ConceptosPage() {
  const { data, isLoading, error } = useFetchQuery<Respuesta>(["conceptos-maestro"], "/api/conceptos", { staleTime: 60_000 });
  const [desde, setDesde] = useState("");
  const [q, setQ] = useState("");
  const [libresAbierta, setLibresAbierta] = usePreferencia("conceptos-libres-abierta", false);
  // Rubros abiertos (por defecto todos cerrados); con búsqueda se abren solos.
  const [rubrosAbiertos, setRubrosAbiertos] = useState<Set<string>>(() => new Set());
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormConcepto | null>(null);
  const [aBorrar, setABorrar] = useState<number | null>(null);
  async function darDeBaja(codigo: number) {
    const res = await fetch(`/api/conceptos/${codigo}`, { method: "DELETE" });
    const d = await res.json().catch(() => null);
    setABorrar(null);
    if (!res.ok) { toast.error(d?.error ?? "No se pudo dar de baja"); return; }
    toast.success(`Concepto ${codigo} dado de baja`);
    await queryClient.invalidateQueries({ queryKey: ["conceptos-maestro"] });
  }
  const conRegistros = useMemo(() => (data?.conRegistros ? new Set(data.conRegistros) : null), [data]);
  const sinUso = (c: ConceptoMaestro) => conRegistros != null && !conRegistros.has(String(c.codigo));

  const conceptos = useMemo(() => data?.conceptos ?? [], [data]);
  const porCodigo = useMemo(() => new Map(conceptos.map((c) => [c.codigo, c])), [conceptos]);
  // MaxiRest usa hasta 999; si alguna organización ya pasó ese número, se amplía.
  const deMaxirest = useMemo(() => conceptos.filter((c) => !esPropio(c.codigo)), [conceptos]);
  const maximo = useMemo(() => Math.max(MAX_CODIGO_CONCEPTO, ...deMaxirest.map((c) => c.codigo)), [deMaxirest]);
  const rangos = useMemo(() => rangosLibres(deMaxirest.map((c) => c.codigo), maximo), [deMaxirest, maximo]);
  const nDesde = Number(desde);
  const consulta = desde !== "" && Number.isInteger(nDesde) && nDesde >= 1 ? nDesde : null;
  const ocupadoPor = consulta != null ? porCodigo.get(consulta) : undefined;
  const sugerido = libreDesde(rangos, consulta ?? 1);
  const primerLibre = libreDesde(rangos, 1);
  const proximoPropio = proximoCodigoLazarillo(conceptos.map((c) => c.codigo));
  // Los códigos libres son los de MaxiRest (1 a 999); los propios van desde 1000.

  const grupos = useMemo(() => {
    const t = q.trim().toLowerCase();
    const filtrados = t
      ? conceptos.filter((c) => String(c.codigo).includes(t) || c.nombre.toLowerCase().includes(t) || (c.rubro ?? "").toLowerCase().includes(t))
      : conceptos;
    const m = new Map<string, ConceptoMaestro[]>();
    for (const c of filtrados) {
      const k = c.rubro ? `${c.codRubro ?? ""} · ${c.rubro}` : "Sin rubro";
      m.set(k, [...(m.get(k) ?? []), c]);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], "es", { numeric: true }));
  }, [conceptos, q]);

  return (
    <div className="p-4 md:p-6 flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-white">Conceptos de caja</h1>
        <p className="text-sm text-muted-foreground">
          Códigos libres para dar de alta en MaxiRest y conceptos propios de Lazarillo (desde el {CODIGO_MIN_LAZARILLO}). Los de MaxiRest se modifican en MaxiRest.
        </p>
      </div>

      {isLoading ? (
        <div className="py-12 flex justify-center"><Spinner size="lg" /></div>
      ) : error ? (
        <p className="text-sm text-destructive">No se pudieron leer los conceptos.</p>
      ) : (
        <>
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/30 p-4 flex flex-col gap-4">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <button type="button" onClick={() => setLibresAbierta(!libresAbierta)} aria-expanded={libresAbierta} className="flex items-start gap-2 text-left">
                <span className="pt-0.5"><Flecha abierta={libresAbierta} /></span>
                <span>
                <div className="text-sm font-medium">Códigos libres</div>
                <div className="text-xs text-muted-foreground">
                  {cantidadLibres(rangos)} libres de {maximo} en MaxiRest · {deMaxirest.length} en uso ·{" "}
                  {data?.fuente === "render" ? "MaxiRest de hoy (Render)" : "maestro importado al Panel"}
                </div>
                </span>
              </button>
              {!libresAbierta ? (
                primerLibre != null && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    Próximo libre <CopiarCodigo codigo={primerLibre} grande />
                  </div>
                )
              ) : (
              <div className="flex items-end gap-3">
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Buscar libre desde
                  <Input
                    inputMode="numeric"
                    placeholder="ej. 300"
                    value={desde}
                    onChange={(e) => setDesde(e.target.value.replace(/\D/g, ""))}
                    className="h-9 w-28"
                  />
                </label>
                {sugerido != null && (
                  <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                    {consulta != null && ocupadoPor ? (
                      <span>El {consulta} es <b className="text-foreground">{ocupadoPor.nombre}</b> · libre:</span>
                    ) : consulta != null && sugerido === consulta ? (
                      <span className="text-emerald-700">El {consulta} está libre</span>
                    ) : (
                      <span>Primer libre</span>
                    )}
                    <CopiarCodigo codigo={sugerido} grande />
                  </div>
                )}
              </div>
              )}
            </div>
            {libresAbierta && (
            <div className="flex flex-wrap gap-1.5">
              {rangos.map((r) => (
                <button
                  key={r.desde}
                  type="button"
                  onClick={() => setDesde(String(r.desde))}
                  title={`${r.hasta - r.desde + 1} libre${r.hasta === r.desde ? "" : "s"}`}
                  className={cn(
                    "h-7 rounded-md border px-2 text-xs tabular-nums hover:bg-muted",
                    consulta != null && consulta >= r.desde && consulta <= r.hasta && "border-sky-400 bg-sky-50 dark:bg-sky-950/30"
                  )}
                >
                  {textoRango(r)}
                </button>
              ))}
            </div>
            )}
          </div>

          <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/30 overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-zinc-100 dark:border-zinc-700/50">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 text-sm font-medium"><Tags className="h-4 w-4 text-muted-foreground" /> En uso</div>
                <button
                  type="button"
                  onClick={() => setRubrosAbiertos(rubrosAbiertos.size >= grupos.length ? new Set() : new Set(grupos.map(([r]) => r)))}
                  className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                >
                  {rubrosAbiertos.size >= grupos.length ? "Cerrar todos" : "Abrir todos"}
                </button>
                {conRegistros && <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><span className="size-1.5 rounded-full bg-zinc-300" /> sin registros en el Panel</span>}
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><span className="rounded bg-sky-100 px-1 text-[10px] font-semibold text-sky-700">LZ</span> de Lazarillo (desde {CODIGO_MIN_LAZARILLO})</span>
              </div>
              <button
                type="button"
                onClick={() => setForm({ codigo: null, nombre: "", tipo: "-", codRubro: "", imputacion: "" })}
                className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
              >
                <Plus className="h-3.5 w-3.5" /> Nuevo concepto
              </button>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar código, concepto o rubro" className="h-8 w-64 pl-7 text-xs" />
              </div>
            </div>
            {form && (
              <FormularioConcepto
                key={form.codigo ?? "nuevo"}
                inicial={form}
                proximo={proximoPropio}
                rubros={data?.rubros ?? []}
                onCerrar={() => setForm(null)}
                onGuardado={() => { setForm(null); void queryClient.invalidateQueries({ queryKey: ["conceptos-maestro"] }); }}
              />
            )}
            <div className="max-h-[60vh] overflow-auto divide-y divide-zinc-100 dark:divide-zinc-700/50">
              {grupos.map(([rubro, cs]) => {
                const abierto = q.trim() !== "" || rubrosAbiertos.has(rubro);
                const nSinUso = cs.filter(sinUso).length;
                return (
                  <div key={rubro} className="px-4 py-2">
                    <button
                      type="button"
                      aria-expanded={abierto}
                      onClick={() => {
                        const n = new Set(rubrosAbiertos);
                        if (n.has(rubro)) n.delete(rubro); else n.add(rubro);
                        setRubrosAbiertos(n);
                      }}
                      className="flex w-full items-center gap-2 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
                    >
                      <Flecha abierta={abierto} />
                      <span className="text-foreground">{rubro}</span>
                      <span className="font-normal">· {cs.length} concepto{cs.length === 1 ? "" : "s"}{nSinUso ? ` · ${nSinUso} sin registros` : ""}</span>
                    </button>
                    {abierto && (
                      // Dos columnas que se leen de arriba abajo: primero la izquierda, después la derecha.
                      <div className="mt-1 columns-1 gap-x-8 text-sm sm:columns-2">
                        {cs.map((c) => (
                          <div key={c.codigo} className="group flex break-inside-avoid items-center gap-3 py-0.5" title={sinUso(c) ? "Sin registros en el Panel" : undefined}>
                            <span className="w-10 shrink-0 tabular-nums text-muted-foreground text-right">{c.codigo}</span>
                            <span className={cn("truncate", sinUso(c) && "text-muted-foreground")}>{c.nombre}</span>
                            {sinUso(c) && <span className="size-1.5 shrink-0 rounded-full bg-zinc-300" />}
                            {esPropio(c.codigo) ? (
                              <span className="ml-auto flex shrink-0 items-center gap-1">
                                <span className="rounded bg-sky-100 px-1 text-[10px] font-semibold text-sky-700">LZ</span>
                                <button
                                  type="button"
                                  title="Modificar"
                                  onClick={() => setForm({ codigo: c.codigo, nombre: c.nombre, tipo: c.tipo ?? "-", codRubro: c.codRubro != null ? String(c.codRubro) : "", imputacion: c.imputacion ?? "" })}
                                  className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted"
                                >
                                  <Pencil className="h-3 w-3" />
                                </button>
                                {aBorrar === c.codigo ? (
                                  <button type="button" onClick={() => darDeBaja(c.codigo)} onBlur={() => setABorrar(null)} className="h-6 rounded bg-destructive px-2 text-[11px] text-white">
                                    ¿Dar de baja?
                                  </button>
                                ) : (
                                  <button type="button" title="Dar de baja" onClick={() => setABorrar(c.codigo)} className="flex h-6 w-6 items-center justify-center rounded text-destructive hover:bg-destructive/10">
                                    <Trash2 className="h-3 w-3" />
                                  </button>
                                )}
                              </span>
                            ) : (
                              <span title="Concepto de MaxiRest: se modifica en MaxiRest" className="ml-auto opacity-0 group-hover:opacity-100">
                                <Lock className="h-3 w-3 text-muted-foreground/60" />
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {grupos.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted-foreground">Sin resultados.</p>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
