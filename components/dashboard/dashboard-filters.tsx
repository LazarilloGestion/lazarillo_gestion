"use client";
import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface PuntoDeVenta {
  id: number;
  nombre: string;
}
interface Local {
  id: number;
  nombre: string;
  puntosDeVenta: PuntoDeVenta[];
}

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
    fetch("/api/locales")
      .then((r) => r.json())
      .then((data: Local[]) => setLocales(Array.isArray(data) ? data : []))
      .catch(() => {});
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
    <div className="flex flex-wrap gap-3 items-center">
      <Select value={year} onValueChange={(v) => updateFilter("year", v)}>
        <SelectTrigger className="w-28">
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

      {locales.length > 0 && (
        <>
          <Select
            value={localId || "__all"}
            onValueChange={(v) => updateFilter("localId", v)}
          >
            <SelectTrigger className="w-44">
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

          {localId && puntosDeVenta.length > 0 && (
            <Select
              value={pdvId || "__all"}
              onValueChange={(v) => updateFilter("pdvId", v)}
            >
              <SelectTrigger className="w-48">
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
          )}
        </>
      )}
    </div>
  );
}
