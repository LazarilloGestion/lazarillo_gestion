"use client";

import { useMemo, useState } from "react";
import { Copy, Check, Search, Tags } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { Input } from "@/components/ui/input";
import { useFetchQuery } from "@/hooks/use-fetch-query";
import { cn } from "@/lib/utils";
import { rangosLibres, cantidadLibres, textoRango, libreDesde, MAX_CODIGO_CONCEPTO } from "@/lib/conceptos/codigos-libres";
import type { ConceptoMaestro } from "@/lib/render/db";

type Respuesta = { fuente: "render" | "panel"; conceptos: ConceptoMaestro[] };

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

  const conceptos = useMemo(() => data?.conceptos ?? [], [data]);
  const porCodigo = useMemo(() => new Map(conceptos.map((c) => [c.codigo, c])), [conceptos]);
  // MaxiRest usa hasta 999; si alguna organización ya pasó ese número, se amplía.
  const maximo = useMemo(() => Math.max(MAX_CODIGO_CONCEPTO, ...conceptos.map((c) => c.codigo)), [conceptos]);
  const rangos = useMemo(() => rangosLibres(conceptos.map((c) => c.codigo), maximo), [conceptos, maximo]);
  const nDesde = Number(desde);
  const consulta = desde !== "" && Number.isInteger(nDesde) && nDesde >= 1 ? nDesde : null;
  const ocupadoPor = consulta != null ? porCodigo.get(consulta) : undefined;
  const sugerido = libreDesde(rangos, consulta ?? 1);

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
          Códigos libres para dar de alta en MaxiRest. El alta, baja y modificación desde acá se habilita cuando se puedan cargar gastos desde el Panel.
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
              <div>
                <div className="text-sm font-medium">Códigos libres</div>
                <div className="text-xs text-muted-foreground">
                  {cantidadLibres(rangos)} libres de {maximo} · {conceptos.length} en uso ·{" "}
                  {data?.fuente === "render" ? "MaxiRest de hoy (Render)" : "maestro importado al Panel"}
                </div>
              </div>
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
            </div>
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
          </div>

          <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/30 overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-zinc-100 dark:border-zinc-700/50">
              <div className="flex items-center gap-2 text-sm font-medium"><Tags className="h-4 w-4 text-muted-foreground" /> En uso</div>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar código, concepto o rubro" className="h-8 w-64 pl-7 text-xs" />
              </div>
            </div>
            <div className="max-h-[60vh] overflow-auto divide-y divide-zinc-100 dark:divide-zinc-700/50">
              {grupos.map(([rubro, cs]) => (
                <div key={rubro} className="px-4 py-2">
                  <div className="mb-1 text-xs font-medium text-muted-foreground">{rubro}</div>
                  <div className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-sm sm:grid-cols-[3.5rem_minmax(0,1fr)_3.5rem_minmax(0,1fr)]">
                    {cs.map((c) => (
                      <div key={c.codigo} className="contents">
                        <span className="tabular-nums text-muted-foreground text-right">{c.codigo}</span>
                        <span className="truncate">{c.nombre}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {grupos.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted-foreground">Sin resultados.</p>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
