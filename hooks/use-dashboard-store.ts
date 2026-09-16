"use client";
import { useEffect } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { MONTH_IDXS } from "@/lib/dashboard/constants";
import { readPersistedField } from "@/lib/dashboard/persisted-sync-read";
import { pick } from "@/lib/pick";
import type { SortCol, SortDir } from "@/lib/dashboard/pivot-utils";
import type { AgrupacionCompras } from "@/lib/dashboard/params";

const DASHBOARD_STORE_KEY = "dashboard:state";

type Tab = "compras" | "ventas" | "resultados";

type SearchFilters = {
  rubroCodigo: string | undefined;
  conceptoCodigo: string | undefined;
  proveedorId: number | undefined;
  observacionQuery: string | undefined;
  searchLabel: string | undefined;
};

type DashboardStore = {
  // months
  stored: number[];
  toggleMonth: (idx: number) => void;
  clearMonths: () => void;

  // sort
  sortCol: SortCol;
  sortDir: SortDir;
  handleSortClick: (col: SortCol) => void;

  // navigation
  year: number;
  tab: Tab;
  localId: number | undefined;
  pdvId: number | undefined;
  setYear: (year: number) => void;
  setTab: (tab: Tab) => void;
  setLocalId: (id: number | undefined) => void;
  setPdvId: (id: number | undefined) => void;
  agrupacionCompras: AgrupacionCompras;
  setAgrupacionCompras: (a: AgrupacionCompras) => void;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;

  // search (not persisted)
  rubroCodigo: string | undefined;
  conceptoCodigo: string | undefined;
  proveedorId: number | undefined;
  observacionQuery: string | undefined;
  searchLabel: string | undefined;
  savedFilters: Record<Tab, SearchFilters>;
  setSearch: (param: string, value: string, label: string) => void;
  clearSearch: () => void;
  switchTab: (tab: Tab) => void;

  // rubro config (Compras)
  rubroConfigVersion: number;
  bumpRubroConfig: () => void;
  rubroVisibleCount: number;
  setRubroVisibleCount: (n: number) => void;

  // rubro config (Resultados)
  resultadosConfigVersion: number;
  bumpResultadosConfig: () => void;
  resultadosVisibleCount: number;
  setResultadosVisibleCount: (n: number) => void;

  // panel colapsable (persistido vía cookie, leída en SSR — ver filters-cookie.ts)
  showFilters: boolean;
  toggleFilters: () => void;
  setShowFilters: (open: boolean) => void;
};

const EMPTY_FILTERS: SearchFilters = {
  rubroCodigo: undefined,
  conceptoCodigo: undefined,
  proveedorId: undefined,
  observacionQuery: undefined,
  searchLabel: undefined,
};

// Única lista de campos persistidos: agregar una key acá alcanza para que
// persista — no hay un segundo lugar que se pueda olvidar (bug real que ya
// ocurrió con agrupacionCompras, ver commit fed696b).
const PERSISTED_FIELD_KEYS = [
  "stored", "sortCol", "sortDir", "year", "tab", "localId", "pdvId",
  "agrupacionCompras", "showFilters", "sidebarOpen",
] as const satisfies readonly (keyof DashboardStore)[];

const useDashboardStore = create<DashboardStore>()(
  persist(
    (set, get) => ({
      // months
      stored: [],
      toggleMonth: (idx) => {
        const next = new Set(get().stored);
        if (next.has(idx)) next.delete(idx); else next.add(idx);
        set({ stored: next.size === 12 ? [] : Array.from(next).sort((a, b) => a - b) });
      },
      clearMonths: () => set({ stored: [] }),

      // sort
      sortCol: 1 as SortCol,
      sortDir: "desc" as SortDir,
      handleSortClick: (col) => {
        const { sortCol, sortDir } = get();
        set(
          sortCol === col
            ? { sortDir: sortDir === "desc" ? "asc" : "desc" }
            : { sortCol: col, sortDir: "desc" }
        );
      },

      // navigation
      year: new Date().getFullYear(),
      tab: "compras",
      localId: undefined,
      pdvId: undefined,
      setYear: (year) => set({ year }),
      setTab: (tab) => set({ tab }),
      setLocalId: (id) => set({ localId: id, pdvId: undefined }),
      setPdvId: (id) => set({ pdvId: id }),
      agrupacionCompras: "concepto" as AgrupacionCompras,
      setAgrupacionCompras: (a) => set({ agrupacionCompras: a }),

      // search
      rubroCodigo: undefined,
      conceptoCodigo: undefined,
      proveedorId: undefined,
      observacionQuery: undefined,
      searchLabel: undefined,
      savedFilters: { compras: { ...EMPTY_FILTERS }, ventas: { ...EMPTY_FILTERS }, resultados: { ...EMPTY_FILTERS } },
      // Solo un filtro de palette activo a la vez (mutuamente excluyentes).
      setSearch: (param, value, label) => {
        set({
          rubroCodigo: param === "rubroCodigo" ? value : undefined,
          conceptoCodigo: param === "conceptoCodigo" ? value : undefined,
          proveedorId: param === "proveedorId" ? Number(value) : undefined,
          observacionQuery: param === "observacionQuery" ? value : undefined,
          searchLabel: label,
        });
      },
      clearSearch: () => set({ ...EMPTY_FILTERS }),
      switchTab: (tab) => {
        const { tab: current, rubroCodigo, conceptoCodigo, proveedorId, observacionQuery, searchLabel, savedFilters } = get();
        const saved = savedFilters[tab] ?? { ...EMPTY_FILTERS };
        set({
          tab,
          savedFilters: { ...savedFilters, [current]: { rubroCodigo, conceptoCodigo, proveedorId, observacionQuery, searchLabel } },
          rubroCodigo: saved.rubroCodigo,
          conceptoCodigo: saved.conceptoCodigo,
          proveedorId: saved.proveedorId,
          observacionQuery: saved.observacionQuery,
          searchLabel: saved.searchLabel,
        });
      },

      // rubro config (Compras)
      rubroConfigVersion: 0,
      bumpRubroConfig: () => set((s) => ({ rubroConfigVersion: s.rubroConfigVersion + 1 })),
      rubroVisibleCount: 0,
      setRubroVisibleCount: (n) => set({ rubroVisibleCount: n }),

      // rubro config (Resultados)
      resultadosConfigVersion: 0,
      bumpResultadosConfig: () => set((s) => ({ resultadosConfigVersion: s.resultadosConfigVersion + 1 })),
      resultadosVisibleCount: 0,
      setResultadosVisibleCount: (n) => set({ resultadosVisibleCount: n }),

      // panel colapsable — seedeado sincrónicamente desde localStorage (ver
      // readPersistedField) para que el primer render de cliente ya arranque
      // con el valor real, sin esperar a un efecto post-mount.
      showFilters: readPersistedField(DASHBOARD_STORE_KEY, "showFilters", true),
      toggleFilters: () => set((s) => ({ showFilters: !s.showFilters })),
      setShowFilters: (open) => set({ showFilters: open }),

      // sidebar de la app (colapsado/expandido) — mismo criterio que showFilters.
      sidebarOpen: readPersistedField(DASHBOARD_STORE_KEY, "sidebarOpen", true),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
    }),
    {
      name: DASHBOARD_STORE_KEY,
      skipHydration: true,
      partialize: (s) => pick(s, PERSISTED_FIELD_KEYS),
    }
  )
);

// Selector liviano para el botón del header (suscribe solo a showFilters).
export function useFiltersPanel() {
  const showFilters = useDashboardStore((s) => s.showFilters);
  const toggleFilters = useDashboardStore((s) => s.toggleFilters);
  const setShowFilters = useDashboardStore((s) => s.setShowFilters);
  return { showFilters, toggleFilters, setShowFilters };
}

// Selector liviano para el sidebar de la app (suscribe solo a sidebarOpen).
export function useSidebarPersisted() {
  const sidebarOpen = useDashboardStore((s) => s.sidebarOpen);
  const setSidebarOpen = useDashboardStore((s) => s.setSidebarOpen);
  return { sidebarOpen, setSidebarOpen };
}

let rehydrated = false;

export function useDashboard() {
  useEffect(() => {
    if (!rehydrated) {
      rehydrated = true;
      useDashboardStore.persist.rehydrate();
    }
  }, []);

  const s = useDashboardStore();

  const months =
    s.stored.length > 0 && s.stored.length < 12
      ? [...s.stored].sort((a, b) => a - b)
      : MONTH_IDXS;
  const activeMonths: number[] | undefined = months.length < 12 ? months : undefined;
  const selectedMonths = new Set(s.stored);

  const sortCol: SortCol =
    s.sortCol === "total" ||
    (typeof s.sortCol === "number" && months.includes(s.sortCol))
      ? s.sortCol
      : months[0];

  // Único filtro de búsqueda activo (mutuamente excluyentes) — derivado acá para que
  // los chips de filtro no reimplementen la cadena de precedencia.
  const activeSearchParam: "rubroCodigo" | "conceptoCodigo" | "proveedorId" | "observacionQuery" | undefined =
    s.rubroCodigo ? "rubroCodigo"
    : s.conceptoCodigo ? "conceptoCodigo"
    : s.proveedorId ? "proveedorId"
    : s.observacionQuery ? "observacionQuery"
    : undefined;

  return {
    // months
    months, activeMonths, selectedMonths,
    toggleMonth: s.toggleMonth, clearMonths: s.clearMonths,
    // sort
    sortCol, sortDir: s.sortDir, handleSortClick: s.handleSortClick,
    // navigation
    year: s.year, tab: s.tab, localId: s.localId, pdvId: s.pdvId,
    setYear: s.setYear, setTab: s.setTab, setLocalId: s.setLocalId, setPdvId: s.setPdvId,
    agrupacionCompras: s.agrupacionCompras, setAgrupacionCompras: s.setAgrupacionCompras,
    // search
    rubroCodigo: s.rubroCodigo, conceptoCodigo: s.conceptoCodigo,
    proveedorId: s.proveedorId, observacionQuery: s.observacionQuery, searchLabel: s.searchLabel,
    activeSearchParam,
    setSearch: s.setSearch, clearSearch: s.clearSearch, switchTab: s.switchTab,
    // rubro config (Compras)
    rubroConfigVersion: s.rubroConfigVersion, bumpRubroConfig: s.bumpRubroConfig,
    rubroVisibleCount: s.rubroVisibleCount, setRubroVisibleCount: s.setRubroVisibleCount,
    // rubro config (Resultados)
    resultadosConfigVersion: s.resultadosConfigVersion, bumpResultadosConfig: s.bumpResultadosConfig,
    resultadosVisibleCount: s.resultadosVisibleCount, setResultadosVisibleCount: s.setResultadosVisibleCount,
  };
}
