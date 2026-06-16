"use client";

import React, { useEffect, useState, useCallback, useMemo, useRef, type ElementType } from "react";
import { useDashboard } from "@/hooks/use-dashboard-store";
import { Layers, Tag, Truck, MessageSquare, ArrowRight, CornerDownLeft, ChevronUp, ChevronDown, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import type { Suggestion } from "@/app/api/search/suggestions/route";
import type { ObservacionResult } from "@/app/api/search/observaciones/route";

type SuggestionType = Suggestion["type"] | "observacion";

const TYPE_CONFIG: Record<
  SuggestionType,
  { label: string; plural: string; icon: ElementType; color: string; bg: string }
> = {
  rubro:       { label: "Rubro",       plural: "Rubros",        icon: Layers,       color: "text-cat-rubro",       bg: "bg-cat-rubro/12" },
  concepto:    { label: "Concepto",    plural: "Conceptos",     icon: Tag,          color: "text-cat-concepto",    bg: "bg-cat-concepto/12" },
  proveedor:   { label: "Proveedor",   plural: "Proveedores",   icon: Truck,        color: "text-cat-proveedor",   bg: "bg-cat-proveedor/12" },
  observacion: { label: "Observación", plural: "Observaciones", icon: MessageSquare,color: "text-cat-observacion", bg: "bg-cat-observacion/12" },
};

const TYPE_ORDER: SuggestionType[] = ["rubro", "concepto", "proveedor"];
const CATEGORY_ORDER: SuggestionType[] = ["rubro", "concepto", "proveedor", "observacion"];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: Props) {
  const { setSearch, setHighlightTarget, highlightedRowId, highlightLabel, clearHighlight } = useDashboard();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<SuggestionType | null>(null);

  // Observaciones — fetched on demand
  const [observaciones, setObservaciones] = useState<ObservacionResult[]>([]);
  const [obsLoading, setObsLoading] = useState(false);
  const obsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open || loaded) return;
    const controller = new AbortController();
    setLoading(true);
    fetch("/api/search/suggestions", { signal: controller.signal })
      .then((r) => r.json())
      .then((data: Suggestion[]) => {
        setSuggestions(Array.isArray(data) ? data : []);
        setLoaded(true);
      })
      .catch((err) => { if (err.name !== "AbortError") console.error(err); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [open, loaded]);

  // Fetch observaciones with debounce when query changes
  useEffect(() => {
    if (obsTimerRef.current) clearTimeout(obsTimerRef.current);
    const q = query.trim();
    if (q.length < 2 || (typeFilter !== null && typeFilter !== "observacion")) {
      setObservaciones([]);
      return;
    }
    obsTimerRef.current = setTimeout(() => {
      const controller = new AbortController();
      setObsLoading(true);
      fetch(`/api/search/observaciones?q=${encodeURIComponent(q)}`, { signal: controller.signal })
        .then((r) => r.json())
        .then((data: ObservacionResult[]) => setObservaciones(Array.isArray(data) ? data : []))
        .catch((err) => { if (err.name !== "AbortError") console.error(err); })
        .finally(() => setObsLoading(false));
      return () => controller.abort();
    }, 300);
    return () => { if (obsTimerRef.current) clearTimeout(obsTimerRef.current); };
  }, [query, typeFilter]);

  const handleClose = useCallback(
    (v: boolean) => {
      if (!v) { setQuery(""); setTypeFilter(null); setObservaciones([]); }
      onOpenChange(v);
    },
    [onOpenChange]
  );

  const handleSelect = useCallback(
    (suggestion: Suggestion) => {
      setSearch(suggestion.param, suggestion.value, suggestion.label);
      handleClose(false);
    },
    [setSearch, handleClose]
  );

  const handleSelectObservacion = useCallback(
    (result: ObservacionResult) => {
      setHighlightTarget({ rowId: result.rowId, rubroCodigo: result.rubroCodigo, conceptoCodigo: result.conceptoCodigo, label: result.label });
      handleClose(false);
    },
    [setHighlightTarget, handleClose]
  );

  const counts = useMemo(
    () =>
      TYPE_ORDER.reduce(
        (acc, t) => ({ ...acc, [t]: t === "observacion" ? observaciones.length : suggestions.filter((s) => s.type === t).length }),
        {} as Record<SuggestionType, number>
      ),
    [suggestions, observaciones]
  );

  const visibleTypes = typeFilter ? [typeFilter] : TYPE_ORDER;
  const showResults = query.trim().length > 0 || typeFilter !== null;

  const grouped = useMemo(
    () =>
      visibleTypes.map((type) => ({
        type,
        cfg: TYPE_CONFIG[type],
        items: type === "observacion" ? [] : suggestions.filter((s) => s.type === type),
      })),
    [suggestions, typeFilter]
  );

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="overflow-hidden p-0 gap-0 border-border/60 shadow-2xl sm:max-w-2xl rounded-xl">
        <DialogTitle className="sr-only">Buscador</DialogTitle>

        <Command className="bg-transparent [&_[cmdk-input-wrapper]_svg]:h-4 [&_[cmdk-input-wrapper]_svg]:w-4">
          {/* Input */}
          <CommandInput
            placeholder="Buscar rubro, concepto, proveedor u observación…"
            value={query}
            onValueChange={(v) => { setQuery(v); if (v) setTypeFilter(null); }}
            className="h-14 text-base border-0 bg-transparent placeholder:text-muted-foreground/50 focus-visible:ring-0"
          />

          {/* Active observacion highlight banner */}
          {highlightedRowId && highlightLabel && (
            <>
              <div className="flex items-center gap-2 px-4 py-2 bg-cat-observacion/8 border-b border-cat-observacion/20">
                <MessageSquare className="h-3.5 w-3.5 text-cat-observacion shrink-0" />
                <span className="flex-1 text-xs text-cat-observacion/80 truncate">
                  Resaltando en tabla: <span className="font-medium text-cat-observacion">{highlightLabel}</span>
                </span>
                <button
                  onClick={() => clearHighlight()}
                  className="h-5 w-5 flex items-center justify-center rounded hover:bg-cat-observacion/15 transition-colors"
                  aria-label="Limpiar búsqueda activa"
                >
                  <X className="h-3 w-3 text-cat-observacion/70" />
                </button>
              </div>
            </>
          )}

          {/* Divider */}
          <div className="h-px bg-border/40 mx-0" />

          <CommandList className="max-h-[380px]">
            {/* Estado vacío — categorías */}
            {!showResults && (
              <CommandGroup
                heading="Buscar en"
                className="[&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground/50 [&_[cmdk-group-heading]]:px-4 [&_[cmdk-group-heading]]:py-2 p-1"
              >
                {loading && (
                  <div className="px-2 py-6 text-center text-xs text-muted-foreground/40">
                    Cargando…
                  </div>
                )}
                {!loading && CATEGORY_ORDER.map((type) => {
                  const cfg = TYPE_CONFIG[type];
                  const Icon = cfg.icon;
                  return (
                    <CommandItem
                      key={type}
                      value={`categoria-${type}`}
                      onSelect={() => setTypeFilter(type)}
                      className="flex items-center gap-3 px-2 py-2 rounded-lg cursor-pointer group"
                    >
                      <span className={`flex h-7 w-7 items-center justify-center rounded-md ${cfg.bg}`}>
                        <Icon className={`h-3.5 w-3.5 ${cfg.color}`} />
                      </span>
                      <span className="flex-1 text-sm text-foreground/90">{cfg.plural}</span>
                      <span className="text-xs text-muted-foreground/40 tabular-nums">{counts[type] || ""}</span>
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors" />
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}

            {/* Resultados */}
            {showResults && (
              <>
                {/* Observaciones sin query — prompt especial */}
                {typeFilter === "observacion" && !query.trim() && (
                  <div className="py-10 text-center text-sm text-muted-foreground/50">
                    Escribí para buscar en observaciones…
                  </div>
                )}

                {!(typeFilter === "observacion" && !query.trim()) && (
                  <CommandEmpty className="py-8 text-center text-sm text-muted-foreground/50">
                    {obsLoading ? "Buscando…" : `Sin resultados para "${query}"`}
                  </CommandEmpty>
                )}
                {grouped.map(({ type, cfg, items }, idx) => {
                  if (type === "observacion") return null; // rendered separately below
                  if (items.length === 0) return null;
                  const Icon = cfg.icon;
                  return (
                    <React.Fragment key={type}>
                      {idx > 0 && <CommandSeparator className="bg-border/30" />}
                      <CommandGroup
                        heading={cfg.plural}
                        className="[&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground/40 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2"
                      >
                        {items.map((s) => (
                          <CommandItem
                            key={s.id}
                            value={`${type} ${s.label}`}
                            onSelect={() => handleSelect(s)}
                            className="mx-1 rounded-lg px-2 py-2 gap-3 cursor-pointer"
                          >
                            <span className={`flex h-6 w-6 items-center justify-center rounded-md shrink-0 ${cfg.bg}`}>
                              <Icon className={`h-3 w-3 ${cfg.color}`} />
                            </span>
                            <span className="flex-1 text-sm text-foreground/90 truncate">{s.label}</span>
                            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${cfg.bg} ${cfg.color}`}>
                              {cfg.label}
                            </span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </React.Fragment>
                  );
                })}

                {/* Observaciones group */}
                {(typeFilter === null || typeFilter === "observacion") && observaciones.length > 0 && (
                  <>
                    <CommandSeparator className="bg-border/30" />
                    <CommandGroup
                      heading="Observaciones"
                      className="[&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground/40 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2"
                    >
                      {observaciones.map((obs) => {
                        const cfg = TYPE_CONFIG.observacion;
                        const Icon = cfg.icon;
                        const dateParts = obs.fecha
                          ? `${obs.fecha.slice(8, 10)}/${obs.fecha.slice(5, 7)}`
                          : null;
                        const meta = [dateParts, obs.proveedorNombre ?? obs.conceptoNombre].filter(Boolean).join(" · ");
                        return (
                          <CommandItem
                            key={obs.id}
                            value={`observacion ${obs.label} ${meta}`}
                            onSelect={() => handleSelectObservacion(obs)}
                            className="mx-1 rounded-lg px-2 py-2 gap-3 cursor-pointer"
                          >
                            <span className={`flex h-6 w-6 items-center justify-center rounded-md shrink-0 ${cfg.bg}`}>
                              <Icon className={`h-3 w-3 ${cfg.color}`} />
                            </span>
                            <span className="flex-1 min-w-0">
                              <span className="block text-[11px] text-muted-foreground/50 truncate">{meta}</span>
                              <span className="block text-sm text-foreground/90 truncate">{obs.label}</span>
                            </span>
                            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0 ${cfg.bg} ${cfg.color}`}>
                              {cfg.label}
                            </span>
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  </>
                )}
              </>
            )}
          </CommandList>

          {/* Footer */}
          <div className="h-px bg-border/40" />
          <div className="flex items-center gap-4 px-4 py-2.5 text-[11px] text-muted-foreground/40">
            <span className="flex items-center gap-1">
              <kbd className="inline-flex h-4 w-4 items-center justify-center rounded border border-border/40 bg-muted">
                <ChevronUp className="h-2.5 w-2.5" />
              </kbd>
              <kbd className="inline-flex h-4 w-4 items-center justify-center rounded border border-border/40 bg-muted">
                <ChevronDown className="h-2.5 w-2.5" />
              </kbd>
              navegar
            </span>
            <span className="flex items-center gap-1">
              <kbd className="inline-flex h-4 px-1 items-center justify-center rounded border border-border/40 bg-muted">
                <CornerDownLeft className="h-2.5 w-2.5" />
              </kbd>
              seleccionar
            </span>
            <span className="flex items-center gap-1">
              <kbd className="inline-flex h-4 px-1.5 items-center justify-center rounded border border-border/40 bg-muted font-mono">
                esc
              </kbd>
              cerrar
            </span>
            {typeFilter && (
              <button
                onClick={() => setTypeFilter(null)}
                className="ml-auto flex items-center gap-1 text-muted-foreground/60 hover:text-muted-foreground transition-colors"
              >
                ← todas las categorías
              </button>
            )}
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
