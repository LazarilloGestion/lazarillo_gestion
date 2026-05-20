"use client";

import { useEffect, useState, useCallback, useMemo, type ElementType } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Layers, Tag, Truck, ArrowRight, CornerDownLeft, ChevronUp, ChevronDown } from "lucide-react";
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

type SuggestionType = Suggestion["type"];

const TYPE_CONFIG: Record<
  SuggestionType,
  { label: string; plural: string; icon: ElementType; color: string; bg: string }
> = {
  rubro:     { label: "Rubro",     plural: "Rubros",      icon: Layers, color: "text-blue-400",    bg: "bg-blue-500/15" },
  concepto:  { label: "Concepto",  plural: "Conceptos",   icon: Tag,    color: "text-violet-400",  bg: "bg-violet-500/15" },
  proveedor: { label: "Proveedor", plural: "Proveedores", icon: Truck,  color: "text-emerald-400", bg: "bg-emerald-500/15" },
};

const TYPE_ORDER: SuggestionType[] = ["rubro", "concepto", "proveedor"];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<SuggestionType | null>(null);

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

  const handleClose = useCallback(
    (v: boolean) => {
      if (!v) { setQuery(""); setTypeFilter(null); }
      onOpenChange(v);
    },
    [onOpenChange]
  );

  const handleSelect = useCallback(
    (suggestion: Suggestion) => {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("rubroCodigo");
      params.delete("conceptoCodigo");
      params.delete("proveedorId");
      params.delete("_searchLabel");
      params.set(suggestion.param, suggestion.value);
      params.set("_searchLabel", suggestion.label);
      router.replace(`/dashboard?${params.toString()}`);
      handleClose(false);
    },
    [router, searchParams, handleClose]
  );

  const counts = useMemo(
    () =>
      TYPE_ORDER.reduce(
        (acc, t) => ({ ...acc, [t]: suggestions.filter((s) => s.type === t).length }),
        {} as Record<SuggestionType, number>
      ),
    [suggestions]
  );

  const visibleTypes = typeFilter ? [typeFilter] : TYPE_ORDER;
  const showResults = query.trim().length > 0 || typeFilter !== null;

  const grouped = useMemo(
    () =>
      visibleTypes.map((type) => ({
        type,
        cfg: TYPE_CONFIG[type],
        items: suggestions.filter((s) => s.type === type),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [suggestions, typeFilter, query]
  );

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="overflow-hidden p-0 gap-0 border-border/60 bg-[#1a1a1a] shadow-2xl shadow-black/60 sm:max-w-2xl rounded-xl">
        <DialogTitle className="sr-only">Buscador</DialogTitle>

        <Command className="bg-transparent [&_[cmdk-input-wrapper]_svg]:h-4 [&_[cmdk-input-wrapper]_svg]:w-4">
          {/* Input */}
          <CommandInput
            placeholder="Buscar rubro, concepto o proveedor…"
            value={query}
            onValueChange={(v) => { setQuery(v); if (v) setTypeFilter(null); }}
            className="h-14 text-base border-0 bg-transparent placeholder:text-muted-foreground/50 focus-visible:ring-0"
          />

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
                {!loading && TYPE_ORDER.map((type) => {
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
                      <span className="text-xs text-muted-foreground/40 tabular-nums">{counts[type]}</span>
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors" />
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}

            {/* Resultados */}
            {showResults && (
              <>
                <CommandEmpty className="py-8 text-center text-sm text-muted-foreground/50">
                  Sin resultados para &ldquo;{query}&rdquo;
                </CommandEmpty>
                {grouped.map(({ type, cfg, items }, idx) => {
                  if (items.length === 0) return null;
                  const Icon = cfg.icon;
                  return (
                    <span key={type}>
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
                            className="mx-1 rounded-lg px-2 py-2 gap-3 data-[selected=true]:bg-white/8 aria-selected:bg-white/8 cursor-pointer"
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
                    </span>
                  );
                })}
              </>
            )}
          </CommandList>

          {/* Footer */}
          <div className="h-px bg-border/40" />
          <div className="flex items-center gap-4 px-4 py-2.5 text-[11px] text-muted-foreground/40">
            <span className="flex items-center gap-1">
              <kbd className="inline-flex h-4 w-4 items-center justify-center rounded border border-border/40 bg-white/5">
                <ChevronUp className="h-2.5 w-2.5" />
              </kbd>
              <kbd className="inline-flex h-4 w-4 items-center justify-center rounded border border-border/40 bg-white/5">
                <ChevronDown className="h-2.5 w-2.5" />
              </kbd>
              navegar
            </span>
            <span className="flex items-center gap-1">
              <kbd className="inline-flex h-4 px-1 items-center justify-center rounded border border-border/40 bg-white/5">
                <CornerDownLeft className="h-2.5 w-2.5" />
              </kbd>
              seleccionar
            </span>
            <span className="flex items-center gap-1">
              <kbd className="inline-flex h-4 px-1.5 items-center justify-center rounded border border-border/40 bg-white/5 font-mono">
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
