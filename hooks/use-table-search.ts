import { useState, useMemo } from "react";

function norm(s: unknown): string {
  if (!s) return "";
  return String(s).toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}

export function useTableSearch<T>(
  data: T[],
  fields: (item: T) => (string | null | undefined)[]
) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = norm(query.trim());
    if (!q) return data;
    return data.filter((item) => fields(item).some((f) => norm(f).includes(q)));
    // fields is stable logic defined inline — intentionally excluded from deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, query]);

  return { query, setQuery, filtered };
}
