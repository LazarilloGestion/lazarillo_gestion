"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { CalendarDays, Building2, Store, Search, X } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CommandPalette } from "@/components/dashboard/command-palette";
import type { Local } from "@/lib/types/domain";

const PALETTE_PARAM_LABELS: Record<string, string> = {
  rubroCodigo: "Rubro",
  conceptoCodigo: "Concepto",
  proveedorId: "Proveedor",
};
const PALETTE_PARAMS = Object.keys(PALETTE_PARAM_LABELS);

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: CURRENT_YEAR - 2019 }, (_, i) => CURRENT_YEAR - i);

export function DashboardFilters() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [locales, setLocales] = useState<Local[]>([]);
  const [localesLoading, setLocalesLoading] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const activeTab = searchParams.get("tab") ?? "compras";
  const isVentas = activeTab === "ventas";

  const year = searchParams.get("year") ?? String(CURRENT_YEAR);
  const localId = searchParams.get("localId") ?? "";
  const pdvId = searchParams.get("pdvId") ?? "";

  // Chip activo del palette (solo hay uno a la vez; no aplica en tab ventas)
  const activeSearchParam = !isVentas ? PALETTE_PARAMS.find((p) => searchParams.get(p)) : undefined;
  const activeSearchLabel = searchParams.get("_searchLabel");
  const activeChips = activeSearchParam
    ? [
        {
          param: activeSearchParam,
          value: activeSearchLabel ?? searchParams.get(activeSearchParam) ?? "",
          label: PALETTE_PARAM_LABELS[activeSearchParam],
        },
      ]
    : [];

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/locales", { signal: controller.signal })
      .then((r) => r.json())
      .then((data: Local[]) => setLocales(Array.isArray(data) ? data : []))
      .catch((err) => {
        if (err.name !== "AbortError") console.error("Error cargando locales:", err);
      })
      .finally(() => setLocalesLoading(false));
    return () => controller.abort();
  }, []);

  // ⌘K / Ctrl+K global — solo en tab compras
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
    locales.find((l) => String(l.id) === localId)?.puntosDeVenta ?? [];

  function updateFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value && value !== "__all") params.set(key, value);
    else params.delete(key);
    if (key === "localId") params.delete("pdvId");
    router.replace(`/dashboard?${params.toString()}`);
  }

  const removeChip = useCallback(
    (param: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.delete(param);
      params.delete("_searchLabel");
      router.replace(`/dashboard?${params.toString()}`);
    },
    [router, searchParams]
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2 items-center">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <CalendarDays className="w-4 h-4 shrink-0" />
          <Select value={year} onValueChange={(v) => updateFilter("year", v)}>
            <SelectTrigger className="w-24 h-8 text-sm">
              <SelectValue placeholder="Año" />
            </SelectTrigger>
            <SelectContent>
              {YEARS.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-1.5 text-muted-foreground min-w-0 flex-1 sm:flex-none">
          <Building2 className="w-4 h-4 shrink-0" />
          <Select
            value={localId || "__all"}
            onValueChange={(v) => updateFilter("localId", v)}
            disabled={localesLoading}
          >
            <SelectTrigger className="w-full sm:w-44 h-8 text-sm">
              <SelectValue placeholder="Todos los locales" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">Todos los locales</SelectItem>
              {locales.map((l) => (
                <SelectItem key={l.id} value={String(l.id)}>
                  {l.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {!localesLoading && localId && puntosDeVenta.length > 0 && (
          <div className="flex items-center gap-1.5 text-muted-foreground min-w-0 flex-1 sm:flex-none">
            <Store className="w-4 h-4 shrink-0" />
            <Select
              value={pdvId || "__all"}
              onValueChange={(v) => updateFilter("pdvId", v)}
            >
              <SelectTrigger className="w-full sm:w-48 h-8 text-sm">
                <SelectValue placeholder="Todos los PDV" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">Todos los PDV</SelectItem>
                {puntosDeVenta.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Botón ⌘K — solo en tab compras */}
        {!isVentas && (
          <Button
            variant="outline"
            size="sm"
            className="h-8 w-8 p-0 sm:w-auto sm:px-3 sm:gap-1.5 text-muted-foreground ml-auto shrink-0"
            onClick={() => setPaletteOpen(true)}
          >
            <Search className="w-3.5 h-3.5" />
            <span className="hidden sm:inline text-sm font-normal">Buscar</span>
            <kbd className="pointer-events-none hidden sm:inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium opacity-100">
              <span className="text-xs">⌘</span>K
            </kbd>
          </Button>
        )}
      </div>

      {/* Chips de filtros activos del palette */}
      {activeChips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {activeChips.map((chip) => (
            <Badge
              key={chip.param}
              variant="secondary"
              className="flex items-center gap-1 pr-1 text-xs"
            >
              <span className="text-muted-foreground">{chip.label}:</span>
              <span className="max-w-[180px] truncate">{chip.value}</span>
              <button
                onClick={() => removeChip(chip.param)}
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
