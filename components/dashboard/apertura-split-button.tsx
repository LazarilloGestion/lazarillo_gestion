"use client";
import { Split } from "lucide-react";
import { cn } from "@/lib/utils";

// Ícono "Aperturar" repetido en los 3 niveles de las tablas de pivot
// (concepto/proveedor y registro) y en el modal de Detalle de compras.
// `puedeAperturar` centraliza el guard de negocio seleccionado — sin eso no
// hay origen para armar la regla — para no repetirlo en cada call site.
export function AperturaSplitButton({
  puedeAperturar,
  tieneReglaActiva,
  onClick,
  variant = "row",
}: {
  puedeAperturar: boolean;
  tieneReglaActiva: boolean;
  onClick: () => void;
  // "block": nivel concepto/proveedor, siempre visible.
  // "row": nivel registro, aparece al hacer hover de la fila (requiere que el
  // <tr> contenedor tenga la clase `group`).
  variant?: "block" | "row";
}) {
  if (!puedeAperturar) return null;

  return (
    <button
      type="button"
      title="Apertura de gastos"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "shrink-0 flex items-center justify-center rounded hover:bg-muted",
        variant === "block"
          ? cn(
              "h-5 w-5 transition-colors",
              tieneReglaActiva ? "text-primary" : "text-muted-foreground/40 hover:text-muted-foreground"
            )
          : cn(
              "h-4 w-4 transition-opacity focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              tieneReglaActiva
                ? "text-primary opacity-100"
                : "text-muted-foreground/40 hover:text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
            )
      )}
    >
      <Split className={variant === "block" ? "w-3 h-3" : "w-2.5 h-2.5"} />
    </button>
  );
}
