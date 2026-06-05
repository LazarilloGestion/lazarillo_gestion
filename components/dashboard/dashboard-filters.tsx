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
import type { Local } from "@/lib/types/domain";

const PALETTE_PARAM_LABELS: Record<string, string> = {
  rubroCodigo: "Rubro",
  conceptoCodigo: "Concepto",
  proveedorId: "Proveedor",
};

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: CURRENT_YEAR - 2019 }, (_, i) => CURRENT_YEAR - i);
const MONTH_LABELS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

export function DashboardFilters() {
  const {
    tab, year, localId, pdvId,
    setYear, setLocalId, setPdvId,
    selectedMonths, toggleMonth, clearMonths,
    rubroCodigo, conceptoCodigo, proveedorId, searchLabel,
    clearSearch,
  } = useDashboard();

  const isVentas = tab === "ventas";

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

  const activeSearchParam = !isVentas
    ? (rubroCodigo ? "rubroCodigo" : conceptoCodigo ? "conceptoCodigo" : proveedorId ? "proveedorId" : undefined)
    : undefined;

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
              className="h-8 w-8 flex items-center justify-center rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:border-zinc-300 dark:hover:border-zinc-600 transition-all shrink-0"
            >
              <Search className="w-3.5 h-3.5" />
            </button>
            <RubrosConfigModal />
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
            <RubrosConfigModal />
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
          {activeChips.map((chip) => (
            <Badge key={chip.param} variant="secondary" className="flex items-center gap-1 pr-1 text-xs">
              <span className="text-muted-foreground">{chip.label}:</span>
              <span className="max-w-[180px] truncate">{chip.value}</span>
              <button
                onClick={clearSearch}
                className="ml-0.5 rounded-full hover:bg-muted-foreground/20 p-0.5"
                aria-label={`Quitar filtro ${chip.label}`}
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      {!isVentas && <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />}
    </div>
  );
}
