import { SearchX } from "lucide-react";

export function PivotLoading() {
  return (
    <div className="flex flex-1 items-center justify-center h-full">
      <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-muted-foreground/20 border-t-muted-foreground" />
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
    <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
      <SearchX className="w-8 h-8 opacity-40" />
      <p className="text-sm">Sin datos para los filtros seleccionados.</p>
    </div>
  );
}
