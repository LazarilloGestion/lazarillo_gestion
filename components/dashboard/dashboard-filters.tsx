"use client";
import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { CalendarDays, Building2, Store } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Local } from "@/lib/types/domain";

const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: currentYear - 2019 }, (_, i) => currentYear - i);

export function DashboardFilters() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [locales, setLocales] = useState<Local[]>([]);

  const year = searchParams.get("year") ?? String(currentYear);
  const localId = searchParams.get("localId") ?? "";
  const pdvId = searchParams.get("pdvId") ?? "";

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/locales", { signal: controller.signal })
      .then((r) => r.json())
      .then((data: Local[]) => setLocales(Array.isArray(data) ? data : []))
      .catch((err) => {
        if (err.name !== "AbortError") console.error("Error cargando locales:", err);
      });
    return () => controller.abort();
  }, []);

  const puntosDeVenta =
    locales.find((l) => String(l.id) === localId)?.puntosDeVenta ?? [];

  function updateFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value && value !== "__all") params.set(key, value);
    else params.delete(key);
    if (key === "localId") params.delete("pdvId");
    router.replace(`/dashboard?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap gap-2 items-center">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <CalendarDays className="w-4 h-4" />
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

      {locales.length > 0 && (
        <>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Building2 className="w-4 h-4" />
            <Select
              value={localId || "__all"}
              onValueChange={(v) => updateFilter("localId", v)}
            >
              <SelectTrigger className="w-44 h-8 text-sm">
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

          {localId && puntosDeVenta.length > 0 && (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Store className="w-4 h-4" />
              <Select
                value={pdvId || "__all"}
                onValueChange={(v) => updateFilter("pdvId", v)}
              >
                <SelectTrigger className="w-48 h-8 text-sm">
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
        </>
      )}
    </div>
  );
}
