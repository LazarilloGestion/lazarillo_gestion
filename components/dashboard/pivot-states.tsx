import { SearchX } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";

export function PivotLoading() {
  return (
    <div className="flex flex-1 items-center justify-center h-full">
      <Spinner />
    </div>
  );
}

export function PivotError() {
  return (
    <div className="text-sm text-destructive py-16 text-center">
      Error al cargar los datos.
    </div>
  );
}

export function PivotEmpty() {
  return (
    <div className="flex flex-col items-center gap-2 py-16 text-zinc-400">
      <SearchX className="w-8 h-8 opacity-40" />
      <p className="text-sm text-center">Sin datos para los filtros seleccionados.</p>
    </div>
  );
}
