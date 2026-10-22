import { useState, useMemo, useCallback } from "react";

export function norm(s: unknown): string {
  if (!s) return "";
  return String(s).toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}

// Filtro puro (testeable): buscador general sobre `fields` + un filtro por
// columna sobre `columnFields` (punto 2 de Pendientes_desarrollo_etapa3,
// "filtros en todas las columnas"). Todos se combinan con AND; cada filtro de
// columna es "contiene", sin acentos ni mayúsculas, igual que el general.
export function filtrarTabla<T>(
  data: T[],
  query: string,
  fields: (item: T) => (string | null | undefined)[],
  columnFilters: Record<string, string>,
  columnFields?: (item: T) => Record<string, string | null | undefined>
): T[] {
  const q = norm(query.trim());
  const porColumna = Object.entries(columnFilters)
    .map(([k, v]) => [k, norm(v.trim())] as const)
    .filter(([, v]) => v.length > 0);
  if (!q && porColumna.length === 0) return data;
  return data.filter((item) => {
    if (q && !fields(item).some((f) => norm(f).includes(q))) return false;
    if (porColumna.length === 0) return true;
    const valores = columnFields ? columnFields(item) : {};
    return porColumna.every(([k, v]) => norm(valores[k]).includes(v));
  });
}

export function useTableSearch<T>(
  data: T[],
  fields: (item: T) => (string | null | undefined)[],
  columnFields?: (item: T) => Record<string, string | null | undefined>
) {
  const [query, setQuery] = useState("");
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});

  const setColumnFilter = useCallback((key: string, value: string) => {
    setColumnFilters((prev) => {
      if (!value) {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: value };
    });
  }, []);
  const clearFilters = useCallback(() => {
    setQuery("");
    setColumnFilters({});
  }, []);

  const filtered = useMemo(
    () => filtrarTabla(data, query, fields, columnFilters, columnFields),
    // fields/columnFields are stable logic defined inline — intentionally excluded from deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, query, columnFilters]
  );

  const hayFiltros = query.trim().length > 0 || Object.values(columnFilters).some((v) => v.trim().length > 0);

  return { query, setQuery, columnFilters, setColumnFilter, clearFilters, hayFiltros, filtered };
}
