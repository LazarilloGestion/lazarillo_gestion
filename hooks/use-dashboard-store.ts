"use client";
import { useEffect } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { MONTH_IDXS } from "@/lib/dashboard/constants";
import type { SortCol, SortDir } from "@/lib/dashboard/pivot-utils";

type Tab = "compras" | "ventas";

type SearchFilters = {
  rubroCodigo: string | undefined;
  conceptoCodigo: string | undefined;
  proveedorId: number | undefined;
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

  // search (not persisted)
  rubroCodigo: string | undefined;
  conceptoCodigo: string | undefined;
  proveedorId: number | undefined;
  searchLabel: string | undefined;
  savedFilters: Record<Tab, SearchFilters>;
  setSearch: (param: string, value: string, label: string) => void;
  clearSearch: () => void;
  switchTab: (tab: Tab) => void;

  // rubro config
  rubroConfigVersion: number;
  bumpRubroConfig: () => void;
  rubroOcultoCount: number;
  setRubroOcultoCount: (n: number) => void;
};

const EMPTY_FILTERS: SearchFilters = {
  rubroCodigo: undefined,
  conceptoCodigo: undefined,
  proveedorId: undefined,
  searchLabel: undefined,
};

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

      // search
      rubroCodigo: undefined,
      conceptoCodigo: undefined,
      proveedorId: undefined,
      searchLabel: undefined,
      savedFilters: { compras: { ...EMPTY_FILTERS }, ventas: { ...EMPTY_FILTERS } },
      // Solo un filtro de palette activo a la vez (mutuamente excluyentes).
      setSearch: (param, value, label) => {
        set({
          rubroCodigo: param === "rubroCodigo" ? value : undefined,
          conceptoCodigo: param === "conceptoCodigo" ? value : undefined,
          proveedorId: param === "proveedorId" ? Number(value) : undefined,
          searchLabel: label,
        });
      },
      clearSearch: () => set({ ...EMPTY_FILTERS }),
      switchTab: (tab) => {
        const { tab: current, rubroCodigo, conceptoCodigo, proveedorId, searchLabel, savedFilters } = get();
        const saved = savedFilters[tab] ?? { ...EMPTY_FILTERS };
        set({
          tab,
          savedFilters: { ...savedFilters, [current]: { rubroCodigo, conceptoCodigo, proveedorId, searchLabel } },
          rubroCodigo: saved.rubroCodigo,
          conceptoCodigo: saved.conceptoCodigo,
          proveedorId: saved.proveedorId,
          searchLabel: saved.searchLabel,
        });
      },

      // rubro config
      rubroConfigVersion: 0,
      bumpRubroConfig: () => set((s) => ({ rubroConfigVersion: s.rubroConfigVersion + 1 })),
      rubroOcultoCount: 0,
      setRubroOcultoCount: (n) => set({ rubroOcultoCount: n }),
    }),
    {
      name: "dashboard:state",
      skipHydration: true,
      partialize: (s) => ({
        stored: s.stored,
        sortCol: s.sortCol,
        sortDir: s.sortDir,
        year: s.year,
        tab: s.tab,
        localId: s.localId,
        pdvId: s.pdvId,
      }),
    }
  )
);

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

  return {
    // months
    months, activeMonths, selectedMonths,
    toggleMonth: s.toggleMonth, clearMonths: s.clearMonths,
    // sort
    sortCol, sortDir: s.sortDir, handleSortClick: s.handleSortClick,
    // navigation
    year: s.year, tab: s.tab, localId: s.localId, pdvId: s.pdvId,
    setYear: s.setYear, setTab: s.setTab, setLocalId: s.setLocalId, setPdvId: s.setPdvId,
    // search
    rubroCodigo: s.rubroCodigo, conceptoCodigo: s.conceptoCodigo,
    proveedorId: s.proveedorId, searchLabel: s.searchLabel,
    setSearch: s.setSearch, clearSearch: s.clearSearch, switchTab: s.switchTab,
    // rubro config
    rubroConfigVersion: s.rubroConfigVersion, bumpRubroConfig: s.bumpRubroConfig,
    rubroOcultoCount: s.rubroOcultoCount, setRubroOcultoCount: s.setRubroOcultoCount,
  };
}
