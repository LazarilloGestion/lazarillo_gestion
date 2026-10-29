"use client";

import { useEffect, useMemo, useState } from "react";
import { Copy, Check, Search, Tags, ChevronDown, ChevronsUpDown, Plus, Pencil, Trash2, Split, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { AperturaGastosModal } from "@/components/dashboard/apertura-gastos-modal";
import { useReglasApertura } from "@/hooks/use-reglas-apertura";
import { useDashboard } from "@/hooks/use-dashboard-store";
import { describirOrigen } from "@/lib/apertura/descripcion-origen";
import { estadoVigenciaRegla, ETIQUETA_ESTADO, formatPorcentaje, resumenVigencia } from "@/lib/apertura/estado-vigencia";
import type { ReglaAperturaDTO } from "@/lib/apertura/types";
import type { Local } from "@/lib/types/domain";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CODIGO_MIN_LAZARILLO, TIPOS_CONCEPTO, esPropio, proximoCodigoLazarillo } from "@/lib/conceptos/abm";
import { Spinner } from "@/components/ui/spinner";
import { Input } from "@/components/ui/input";
import { useFetchQuery } from "@/hooks/use-fetch-query";
import { cn } from "@/lib/utils";
import { rangosLibres, cantidadLibres, textoRango, libreDesde, MAX_CODIGO_CONCEPTO } from "@/lib/conceptos/codigos-libres";
import type { ConceptoMaestro } from "@/lib/render/db";

// Concepto de MaxiRest editado en Lazarillo (Diego 29/10/2026): `original` es el de MaxiRest (en gris).
type OriginalMx = { nombre: string; tipo: string | null; codRubro: number | null; rubro: string | null };
type ConceptoUI = ConceptoMaestro & { editado?: boolean; original?: OriginalMx };
type Respuesta = { fuente: "render" | "panel"; conceptos: ConceptoUI[]; conRegistros: string[] | null; rubros: { codigo: string; nombre: string }[] };

type FormConcepto = { codigo: number | null; nombre: string; tipo: string; codRubro: string; padrino: string | null; original?: OriginalMx; editado?: boolean };
type Opcion = { valor: string; texto: string; detalle?: string };

// Lista desplegable con buscador (rubro y padrino).
function Buscador({ valor, opciones, placeholder, vacio, ancho, onCambio }: {
  valor: string;
  opciones: Opcion[];
  placeholder: string;
  vacio: string;
  ancho: string;
  onCambio: (v: string) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const elegido = opciones.find((o) => o.valor === valor);
  return (
    <Popover open={abierto} onOpenChange={setAbierto}>
      <PopoverTrigger asChild>
        <button type="button" className={cn("flex h-8 items-center justify-between gap-2 rounded-md border bg-background px-2 text-left text-sm hover:bg-muted/50", ancho)}>
          <span className={cn("truncate", !elegido && "text-muted-foreground")}>{elegido?.texto ?? vacio}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <Command>
          <CommandInput placeholder={placeholder} className="h-9 text-sm" />
          <CommandList className="max-h-64">
            <CommandEmpty className="py-3 text-center text-xs text-muted-foreground">Sin resultados.</CommandEmpty>
            {opciones.map((o) => (
              <CommandItem key={o.valor} value={`${o.texto} ${o.detalle ?? ""}`} onSelect={() => { onCambio(o.valor); setAbierto(false); }} className="text-sm">
                <Check className={cn("mr-1 h-3.5 w-3.5", valor === o.valor ? "opacity-100" : "opacity-0")} />
                <span className="truncate">{o.texto}</span>
                {o.detalle && <span className="ml-auto pl-2 text-xs text-muted-foreground truncate">{o.detalle}</span>}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// Reglas de apertura activas de un concepto, en una línea por regla.
function ListaReglas({ reglas, locales }: { reglas: ReglaAperturaDTO[]; locales: Local[] }) {
  return (
    <ul className="flex flex-col gap-1">
      {reglas.map((r) => {
        const vigente = estadoVigenciaRegla(r) === "vigente";
        return (
          <li key={r.id} className={cn("flex flex-wrap items-center gap-x-2 text-xs", !vigente && "text-muted-foreground")}>
            <span className="font-medium">{describirOrigen(locales, r.origenLocalId, r.origenPuntoDeVentaId)}</span>
            <span>→</span>
            <span>{r.destinos.map((d) => `${describirOrigen(locales, d.localId, d.puntoDeVentaId)} ${formatPorcentaje(d.porcentaje)}`).join(" · ")}</span>
            <span className="text-muted-foreground">· {resumenVigencia(r)}</span>
            {!vigente && <span className="rounded border px-1 text-[10px]">{ETIQUETA_ESTADO[estadoVigenciaRegla(r)]}</span>}
          </li>
        );
      })}
    </ul>
  );
}

// Alta / modificación de un concepto propio de Lazarillo (código desde 1000).
function FormularioConcepto({
  inicial,
  proximo,
  rubros,
  conceptos,
  reglasDe,
  locales,
  onAbrirReglas,
  onCerrar,
  onGuardado,
}: {
  inicial: FormConcepto;
  proximo: number;
  rubros: { codigo: string; nombre: string }[];
  conceptos: ConceptoUI[];
  reglasDe: (codigo: string | number) => ReglaAperturaDTO[];
  locales: Local[];
  onAbrirReglas: (codigo: number, nombre: string) => void;
  onCerrar: () => void;
  onGuardado: () => void;
}) {
  const [f, setF] = useState(inicial);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editando = inicial.codigo != null;
  const deMaxirest = editando && !esPropio(inicial.codigo!);
  const orig = inicial.original;
  const padrino = f.padrino != null ? conceptos.find((c) => String(c.codigo) === f.padrino) : undefined;
  // Reglas que se ven: las del concepto (al modificar) o las que se copian del padrino.
  const reglas = editando ? reglasDe(inicial.codigo!) : padrino ? reglasDe(padrino.codigo) : [];
  function elegirPadrino(v: string) {
    const p = conceptos.find((c) => String(c.codigo) === v);
    if (!p) return;
    setF({
      ...f,
      padrino: v,
      tipo: p.tipo && ["-", "+", "E"].includes(p.tipo) ? p.tipo : f.tipo,
      codRubro: p.codRubro != null ? String(p.codRubro) : f.codRubro,
    });
  }
  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      const res = await fetch(editando ? `/api/conceptos/${inicial.codigo}` : "/api/conceptos", {
        method: editando ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: f.nombre, tipo: f.tipo, codRubro: f.codRubro, ...(!editando && f.padrino ? { padrino: f.padrino } : {}) }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) { setError(d?.error ?? "No se pudo guardar"); return; }
      const extra = d?.reglasCopiadas ? ` con ${d.reglasCopiadas} regla${d.reglasCopiadas === 1 ? "" : "s"} de apertura` : "";
      toast.success(editando ? `Concepto ${inicial.codigo} actualizado` : `Concepto ${d?.codigo} creado${extra}`);
      onGuardado();
    } catch {
      setError("Error de red");
    } finally {
      setGuardando(false);
    }
  }
  async function restaurar() {
    setGuardando(true);
    setError(null);
    const res = await fetch(`/api/conceptos/${inicial.codigo}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ restaurar: true }) }).catch(() => null);
    setGuardando(false);
    if (!res?.ok) { setError("No se pudo volver al de MaxiRest"); return; }
    toast.success(`Concepto ${inicial.codigo}: volvió al de MaxiRest`);
    onGuardado();
  }
  // Original de MaxiRest debajo de cada campo (en gris, no se edita).
  const original = (v: string | null | undefined) => (deMaxirest && orig ? <span className="text-[11px] text-zinc-400" title="Original de MaxiRest">MaxiRest: {v || "—"}</span> : null);
  const campo = "h-8 rounded-md border bg-background px-2 text-sm";
  const opcionesRubro = rubros.map((r) => ({ valor: r.codigo, texto: `${r.codigo} · ${r.nombre}` }));
  const opcionesPadrino = conceptos.map((c) => ({ valor: String(c.codigo), texto: `${c.codigo} · ${c.nombre}`, detalle: c.rubro ?? undefined }));
  return (
    <div className="mx-4 my-3 rounded-lg border border-sky-200 bg-sky-50/60 p-3 dark:border-sky-900 dark:bg-sky-950/20">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium">
          {deMaxirest ? `Modificar concepto ${inicial.codigo} de MaxiRest · lo que cambies vale solo en Lazarillo (el código no cambia)` : editando ? `Modificar concepto ${inicial.codigo}` : `Nuevo concepto de Lazarillo · código ${proximo}`}
        </span>
        {!editando && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Copiar de (padrino)
            <Buscador valor={f.padrino ?? ""} opciones={opcionesPadrino} placeholder="Buscar concepto..." vacio="Ninguno" ancho="w-64" onCambio={elegirPadrino} />
            {f.padrino && (
              <button type="button" onClick={() => setF({ ...f, padrino: null })} className="text-muted-foreground hover:text-foreground" title="Sin padrino">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </label>
        )}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">Nombre
          <Input autoFocus value={f.nombre} maxLength={60} onChange={(e) => setF({ ...f, nombre: e.target.value })} className="h-8 w-64" />
          {original(orig?.nombre)}
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">Tipo
          <select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })} className={campo}>
            {TIPOS_CONCEPTO.map((t) => <option key={t.valor} value={t.valor}>{t.etiqueta}</option>)}
          </select>
          {original(orig ? TIPOS_CONCEPTO.find((t) => t.valor === orig.tipo)?.etiqueta ?? orig.tipo : null)}
        </label>
        <div className="flex flex-col gap-1 text-xs text-muted-foreground">Rubro
          <Buscador valor={f.codRubro} opciones={opcionesRubro} placeholder="Buscar rubro..." vacio="Elegí un rubro" ancho="w-64" onCambio={(v) => setF({ ...f, codRubro: v })} />
          {original(orig ? `${orig.codRubro ?? ""} · ${orig.rubro ?? ""}` : null)}
        </div>
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
          {deMaxirest && inicial.editado && (
            <button type="button" onClick={restaurar} disabled={guardando} className="h-8 rounded-md px-2 text-xs text-muted-foreground hover:text-foreground hover:underline">
              Volver al de MaxiRest
            </button>
          )}
        </div>
      </div>
      <div className="mt-3 border-t border-sky-200/70 pt-2 dark:border-sky-900">
        <div className="mb-1 flex items-center gap-2 text-xs font-medium">
          <Split className="h-3.5 w-3.5 text-muted-foreground" /> Reglas de apertura
          {editando && (
            <button type="button" onClick={() => onAbrirReglas(inicial.codigo!, f.nombre)} className="font-normal text-sky-700 hover:underline">
              {reglas.length ? "Ver / modificar" : "+ Definir regla"}
            </button>
          )}
        </div>
        {reglas.length ? (
          <>
            {!editando && padrino && <p className="mb-1 text-xs text-muted-foreground">Se copian de {padrino.codigo} · {padrino.nombre}:</p>}
            <ListaReglas reglas={reglas} locales={locales} />
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            {editando ? "Sin reglas: los gastos quedan en el PDV donde se cargan." : padrino ? `${padrino.nombre} no tiene reglas de apertura.` : "Elegí un padrino para copiar sus reglas, o definilas desde la lista una vez creado."}
          </p>
        )}
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  );
}

// Chip de la lista: el reparto de la regla vigente (o "N reglas").
function resumenReglas(reglas: ReglaAperturaDTO[], locales: Local[]): string {
  const vigentes = reglas.filter((r) => estadoVigenciaRegla(r) === "vigente");
  if (vigentes.length === 1) {
    const r = vigentes[0];
    const pdv = (d: ReglaAperturaDTO["destinos"][number]) =>
      locales.flatMap((l) => l.puntosDeVenta).find((p) => p.id === d.puntoDeVentaId)?.nombre ?? describirOrigen(locales, d.localId, null);
    return r.destinos.map((d) => `${pdv(d)} ${formatPorcentaje(d.porcentaje)}`).join(" / ");
  }
  return `${reglas.length} regla${reglas.length === 1 ? "" : "s"}`;
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
  // Dónde se abre el formulario: arriba (null) o dentro de un rubro.
  const [formEn, setFormEn] = useState<string | null>(null);
  const [aBorrar, setABorrar] = useState<number | null>(null);
  const { reglas } = useReglasApertura();
  const { data: locales } = useFetchQuery<Local[]>(["locales"], "/api/locales");
  const { localId, pdvId } = useDashboard();
  const [reglasDe_, setReglasDe] = useState<{ codigo: number; nombre: string } | null>(null);
  // Reglas activas de nivel concepto, por código.
  const reglasPorConcepto = useMemo(() => {
    const m = new Map<string, ReglaAperturaDTO[]>();
    for (const r of reglas) if (r.nivel === "concepto" && r.estado === "activa") m.set(r.entidadId, [...(m.get(r.entidadId) ?? []), r]);
    return m;
  }, [reglas]);
  const reglasDe = (codigo: string | number) => reglasPorConcepto.get(String(codigo)) ?? [];
  const nuevo = (codRubro = "", en: string | null = null) => { setFormEn(en); setForm({ codigo: null, nombre: "", tipo: "-", codRubro, padrino: null }); };
  async function darDeBaja(codigo: number) {
    const res = await fetch(`/api/conceptos/${codigo}`, { method: "DELETE" });
    const d = await res.json().catch(() => null);
    setABorrar(null);
    if (!res.ok) { toast.error(d?.error ?? "No se pudo dar de baja"); return; }
    toast.success(`Concepto ${codigo} dado de baja`);
    await queryClient.invalidateQueries({ queryKey: ["conceptos-maestro"] });
  }
  const conRegistros = useMemo(() => (data?.conRegistros ? new Set(data.conRegistros) : null), [data]);
  const sinUso = (c: ConceptoUI) => conRegistros != null && !conRegistros.has(String(c.codigo));

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
    const m = new Map<string, ConceptoUI[]>();
    for (const c of filtrados) {
      const k = c.rubro ? `${c.codRubro ?? ""} · ${c.rubro}` : "Sin rubro";
      m.set(k, [...(m.get(k) ?? []), c]);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], "es", { numeric: true }));
  }, [conceptos, q]);

  const formulario = form && (
              <FormularioConcepto
                key={form.codigo ?? "nuevo"}
                inicial={form}
                proximo={proximoPropio}
                rubros={data?.rubros ?? []}
                conceptos={conceptos}
                reglasDe={reglasDe}
                locales={locales ?? []}
                onAbrirReglas={(codigo, nombre) => setReglasDe({ codigo, nombre })}
                onCerrar={() => setForm(null)}
                onGuardado={() => { setForm(null); void queryClient.invalidateQueries({ queryKey: ["apertura-reglas"] }); void queryClient.invalidateQueries({ queryKey: ["conceptos-maestro"] }); }}
              />
  );

  return (
    <div className="p-4 md:p-6 flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-white">Conceptos de caja</h1>
        <p className="text-sm text-muted-foreground">
          Códigos libres para dar de alta en MaxiRest y conceptos propios de Lazarillo (desde el {CODIGO_MIN_LAZARILLO}). Los de MaxiRest también se pueden modificar acá: vale solo en Lazarillo y el original queda en gris.
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
                onClick={() => nuevo()}
                className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
              >
                <Plus className="h-3.5 w-3.5" /> Nuevo concepto
              </button>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar código, concepto o rubro" className="h-8 w-64 pl-7 text-xs" />
              </div>
            </div>
            {form && formEn == null && formulario}
            <div className="max-h-[60vh] overflow-auto divide-y divide-zinc-100 dark:divide-zinc-700/50">
              {grupos.map(([rubro, cs]) => {
                const abierto = q.trim() !== "" || rubrosAbiertos.has(rubro);
                const nSinUso = cs.filter(sinUso).length;
                return (
                  <div key={rubro} className="px-4 py-2">
                    <div className="group/rubro flex items-center gap-2">
                    <button
                      type="button"
                      aria-expanded={abierto}
                      onClick={() => {
                        const n = new Set(rubrosAbiertos);
                        if (n.has(rubro)) n.delete(rubro); else n.add(rubro);
                        setRubrosAbiertos(n);
                      }}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
                    >
                      <Flecha abierta={abierto} />
                      <span className="text-foreground">{rubro}</span>
                      <span className="font-normal">· {cs.length} concepto{cs.length === 1 ? "" : "s"}{nSinUso ? ` · ${nSinUso} sin registros` : ""}</span>
                    </button>
                    {cs[0]?.codRubro != null && (
                      <button
                        type="button"
                        title={`Nuevo concepto en ${rubro}`}
                        onClick={() => {
                          setRubrosAbiertos(new Set(rubrosAbiertos).add(rubro));
                          nuevo(String(cs[0].codRubro), rubro);
                        }}
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded border text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    )}
                    </div>
                    {form && formEn === rubro && <div className="-mx-4">{formulario}</div>}
                    {abierto && (
                      // Dos columnas que se leen de arriba abajo: primero la izquierda, después la derecha.
                      <div className="mt-1 columns-1 gap-x-8 text-sm sm:columns-2">
                        {cs.map((c) => (
                          <div key={c.codigo} className="group flex break-inside-avoid items-center gap-3 py-0.5" title={sinUso(c) ? "Sin registros en el Panel" : undefined}>
                            <span className="w-10 shrink-0 tabular-nums text-muted-foreground text-right">{c.codigo}</span>
                            <span className={cn("min-w-0 truncate", sinUso(c) && "text-muted-foreground")} title={c.editado && c.original ? `MaxiRest: ${c.original.nombre}${c.original.rubro ? ` · ${c.original.rubro}` : ""}` : undefined}>
                              {c.nombre}
                              {c.editado && c.original && <span className="ml-1.5 text-[11px] text-zinc-400">MaxiRest: {c.original.nombre}</span>}
                            </span>
                            {sinUso(c) && <span className="size-1.5 shrink-0 rounded-full bg-zinc-300" />}
                            {reglasDe(c.codigo).length > 0 ? (
                              <button
                                type="button"
                                title="Reglas de apertura"
                                onClick={() => setReglasDe({ codigo: c.codigo, nombre: c.nombre })}
                                className="inline-flex h-5 shrink-0 items-center gap-1 rounded bg-violet-100 px-1.5 text-[10px] font-medium text-violet-700 hover:bg-violet-200 dark:bg-violet-950/40 dark:text-violet-300"
                              >
                                <Split className="h-3 w-3" /> {resumenReglas(reglasDe(c.codigo), locales ?? [])}
                              </button>
                            ) : (
                              <button
                                type="button"
                                title="Definir regla de apertura"
                                onClick={() => setReglasDe({ codigo: c.codigo, nombre: c.nombre })}
                                className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-muted group-hover:opacity-100"
                              >
                                <Split className="h-3 w-3" />
                              </button>
                            )}
                            {esPropio(c.codigo) ? (
                              <span className="ml-auto flex shrink-0 items-center gap-1">
                                <span className="rounded bg-sky-100 px-1 text-[10px] font-semibold text-sky-700">LZ</span>
                                <button
                                  type="button"
                                  title="Modificar"
                                  onClick={() => { setFormEn(rubro); setForm({ codigo: c.codigo, nombre: c.nombre, tipo: c.tipo ?? "-", codRubro: c.codRubro != null ? String(c.codRubro) : "", padrino: null }); }}
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
                              <span className="ml-auto flex shrink-0 items-center gap-1">
                                {c.editado && <span className="rounded bg-violet-100 px-1 text-[10px] font-semibold text-violet-700" title="Modificado en Lazarillo">EDITADO</span>}
                                <button
                                  type="button"
                                  title="Modificar en Lazarillo (el original de MaxiRest queda guardado)"
                                  onClick={() => { setFormEn(rubro); setForm({ codigo: c.codigo, nombre: c.nombre, tipo: c.tipo ?? "-", codRubro: c.codRubro != null ? String(c.codRubro) : "", padrino: null,
                                    original: c.original ?? { nombre: c.nombre, tipo: c.tipo, codRubro: c.codRubro, rubro: c.rubro }, editado: !!c.editado }); }}
                                  className={cn("flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted", !c.editado && "opacity-0 group-hover:opacity-100")}
                                >
                                  <Pencil className="h-3 w-3" />
                                </button>
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
      <AperturaGastosModal
        nivel="concepto"
        entidadId={reglasDe_ ? String(reglasDe_.codigo) : null}
        entidadNombre={reglasDe_ ? `${reglasDe_.codigo} · ${reglasDe_.nombre}` : ""}
        origenLocalId={localId ?? null}
        origenPdvId={pdvId ?? null}
        origenEditable
        onClose={() => setReglasDe(null)}
      />
    </div>
  );
}
