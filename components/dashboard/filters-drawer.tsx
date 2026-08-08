"use client";

import { useDashboard } from "@/hooks/use-dashboard-store";
import { CalendarDays, Building2, Store } from "lucide-react";
import {
  Drawer,
  DrawerTrigger,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Local } from "@/lib/types/domain";

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: CURRENT_YEAR - 2024 }, (_, i) => CURRENT_YEAR - i);

type Props = {
  locales: Local[];
  localesLoading: boolean;
};

export function FiltersDrawer({ locales, localesLoading }: Props) {
  const { year, localId, pdvId, setYear, setLocalId, setPdvId } = useDashboard();

  const selectedLocal = locales.find((l) => l.id === localId);
  const puntosDeVenta = selectedLocal?.puntosDeVenta ?? [];

  function summary(): string {
    const parts: string[] = [String(year)];
    if (selectedLocal) parts.push(selectedLocal.nombre);
    return parts.join(" · ");
  }

  return (
    <Drawer>
      <DrawerTrigger asChild>
        <button className="h-8 flex items-center gap-2 px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 text-sm transition-all shrink-0 min-w-0 max-w-[160px]">
          <CalendarDays className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{summary()}</span>
        </button>
      </DrawerTrigger>

      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Filtros</DrawerTitle>
        </DrawerHeader>

        <div className="flex flex-col gap-4 p-4 pt-2 pb-10">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <CalendarDays className="w-3.5 h-3.5" />
              Año
            </label>
            <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
              <SelectTrigger className="h-11 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {YEARS.map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5" />
              Local
            </label>
            <Select
              value={localId ? String(localId) : "__all"}
              onValueChange={(v) => { setLocalId(v === "__all" ? undefined : Number(v)); setPdvId(undefined); }}
              disabled={localesLoading}
            >
              <SelectTrigger className="h-11 text-sm">
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

          {localId && puntosDeVenta.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <Store className="w-3.5 h-3.5" />
                Punto de venta
              </label>
              <Select
                value={pdvId ? String(pdvId) : "__all"}
                onValueChange={(v) => setPdvId(v === "__all" ? undefined : Number(v))}
              >
                <SelectTrigger className="h-11 text-sm">
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
        </div>
      </DrawerContent>
    </Drawer>
  );
}
