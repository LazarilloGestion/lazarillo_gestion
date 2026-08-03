"use client";

import { useEffect, useState } from "react";
import { useDashboard } from "@/hooks/use-dashboard-store";
import { CalendarDays, Building2, Store, Search, X, Filter } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { CommandPalette } from "@/components/dashboard/command-palette";
import { RubrosConfigModal } from "@/components/dashboard/rubros-config-modal";
import { MonthFilterDrawer } from "@/components/dashboard/month-filter-drawer";
import { FiltersDrawer } from "@/components/dashboard/filters-drawer";
import { useIsMobile } from "@/hooks/use-mobile";
import type { Local } from "@/lib/types/domain";

const PALETTE_PARAM_LABELS: Record<string, string> = {
  rubroCodigo:      "Rubro",
  conceptoCodigo:   "Concepto",
  proveedorId:      "Proveedor",
  observacionQuery: "Observación",
};

const PALETTE_PARAM_COLORS: Record<string, { label: string; bg: string; border: string }> = {
  rubroCodigo:      { label: "text-cat-rubro",        bg: "bg-cat-rubro/8",        border: "border-cat-rubro/25" },
  conceptoCodigo:   { label: "text-cat-concepto",     bg: "bg-cat-concepto/8",     border: "border-cat-concepto/25" },
  proveedorId:      { label: "text-cat-proveedor",    bg: "bg-cat-proveedor/8",    border: "border-cat-proveedor/25" },
  observacionQuery: { label: "text-cat-observacion",  bg: "bg-cat-observacion/8",  border: "border-cat-observacion/25" },
};

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: CURRENT_YEAR - 2024 }, (_, i) => CURRENT_YEAR - i);
const MONTH_LABELS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

export function DashboardFilters() {
  const {
    tab, year, localId, pdvId,
    setYear, setLocalId, setPdvId,
    selectedMonths, toggleMonth, clearMonths,
    activeSearchParam: activeParam, searchLabel,
    clearSearch,
  } = useDashboard();

  const isVentas = tab === "ventas";
  const isResultados = tab === "resultados";
  const rubrosConfigProps = isResultados
    ? { field: "visibleEnResultados" as const, title: "Conceptos visibles en Resultados" }
    : {};
  const isMobile = useIsMobile();

  const [locales, setLocales] = useState<Local[]>([]);
  const [localesLoading, setLocalesLoading] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/locales", { signal: controller.signal })
      .then((r) => r.json())
      .then((data: Local[]) => setLocales(Array.isArray(data) ? data : []))
      .catch((err) => { if (err.name !== "AbortError") console.error("Error cargando locales:", err); })
      .finally(() => setLocalesLoading(false));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (isVentas) return;
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setPaletteOpen(true);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isVentas]);

  const puntosDeVenta =
    locales.find((l) => l.id === localId)?.puntosDeVenta ?? [];

  const activeSearchParam = !isVentas ? activeParam : undefined;

  const activeChips = activeSearchParam
    ? [{
        param: activeSearchParam,
        value: searchLabel ?? "",
        label: PALETTE_PARAM_LABELS[activeSearchParam],
      }]
    : [];

  return (
    <div className="flex flex-col gap-2">
      {/* ── Mobile ── */}
      <div className="flex md:hidden gap-2 items-center">
        <FiltersDrawer locales={locales} localesLoading={localesLoading} />
        <MonthFilterDrawer />
        {!isVentas && (
          <>
            <button
              onClick={() => setPaletteOpen(true)}
              className="h-8 w-8 flex items-center justify-center rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-muted-foreground hover:text-zinc-700 dark:hover:text-zinc-200 hover:border-zinc-300 dark:hover:border-zinc-600 transition-all shrink-0"
            >
              <Search className="w-3.5 h-3.5" />
            </button>
            {isMobile && <RubrosConfigModal {...rubrosConfigProps} />}
          </>
        )}
      </div>

      {/* ── Desktop ── */}
      <div className="hidden md:flex gap-2 items-center">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <CalendarDays className="w-4 h-4 shrink-0" />
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="w-24 h-8 text-sm">
              <SelectValue placeholder="Año" />
            </SelectTrigger>
            <SelectContent>
              {YEARS.map((y) => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Building2 className="w-4 h-4 shrink-0" />
          <Select
            value={localId ? String(localId) : "__all"}
            onValueChange={(v) => setLocalId(v === "__all" ? undefined : Number(v))}
            disabled={localesLoading}
          >
            <SelectTrigger className="w-44 h-8 text-sm">
              <SelectValue placeholder="Todos los locales" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">Todos los locales</SelectItem>
              {locales.map((l) => (
                <SelectItem key={l.id} value={String(l.id)}>{l.nombre}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {!localesLoading && localId && puntosDeVenta.length > 0 && (
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Store className="w-4 h-4 shrink-0" />
            <Select
              value={pdvId ? String(pdvId) : "__all"}
              onValueChange={(v) => setPdvId(v === "__all" ? undefined : Number(v))}
            >
              <SelectTrigger className="w-48 h-8 text-sm">
                <SelectValue placeholder="Todos los PDV" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">Todos los PDV</SelectItem>
                {puntosDeVenta.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.nombre}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {!isVentas && (
          <div className="flex items-center gap-2 ml-auto shrink-0">
            {!isMobile && <RubrosConfigModal {...rubrosConfigProps} />}
            <button
              onClick={() => setPaletteOpen(true)}
              className="h-8 w-auto px-3 flex items-center justify-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:border-zinc-300 dark:hover:border-zinc-600 transition-all"
            >
              <Search className="w-3.5 h-3.5" />
              <span className="text-sm font-normal">Buscar</span>
              <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border border-zinc-200 dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-700 px-1.5 font-mono text-[10px] font-medium text-zinc-400">
                <span className="text-xs">⌘</span>K
              </kbd>
            </button>
          </div>
        )}
      </div>

      {/* Chips de meses — solo desktop */}
      <div className="hidden md:flex items-center gap-1.5 flex-wrap">
        <Filter className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        {MONTH_LABELS.map((label, i) => {
          const idx = i + 1;
          const active = selectedMonths.has(idx);
          return (
            <button
              key={idx}
              onClick={() => toggleMonth(idx)}
              aria-pressed={active}
              className={cn(
                "h-6 px-2 rounded-md text-xs font-medium transition-all duration-100 border",
                active
                  ? "bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 border-zinc-900 dark:border-white"
                  : "bg-white dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700 hover:border-zinc-400 dark:hover:border-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200"
              )}
            >
              {label}
            </button>
          );
        })}
        {selectedMonths.size > 0 && (
          <button
            onClick={clearMonths}
            className="h-6 px-1.5 rounded text-xs text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Limpiar filtro de meses"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {activeChips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {activeChips.map((chip) => {
            const colors = PALETTE_PARAM_COLORS[chip.param];
            return (
              <span
                key={chip.param}
                className={cn(
                  "inline-flex items-center gap-1 pr-1.5 pl-2 py-0.5 rounded-full text-xs border",
                  colors.bg, colors.border
                )}
              >
                <span className={cn("font-medium", colors.label)}>{chip.label}:</span>
                <span className="text-foreground/80 max-w-[180px] truncate">{chip.value}</span>
                <button
                  onClick={clearSearch}
                  className={cn("ml-0.5 rounded-full p-0.5 hover:bg-foreground/10 transition-colors", colors.label)}
                  aria-label={`Quitar filtro ${chip.label}`}
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </span>
            );
          })}
        </div>
      )}

      {!isVentas && <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />}
    </div>
  );
}
