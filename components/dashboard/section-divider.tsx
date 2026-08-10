import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface SectionDividerProps {
  label: string;
  icon: LucideIcon;
  colSpan: number;
  // El techo de cada tarjeta (Caja/Societario/Detalle) es esta banda — pone el borde
  // superior y las esquinas redondeadas de la tarjeta. "Operación" no la usa: su techo
  // es directamente la fila de Ingresos, ver kpi-block.tsx.
  topOfCard?: boolean;
}

export function SectionDivider({ label, icon: Icon, colSpan, topOfCard }: SectionDividerProps) {
  return (
    <tr>
      <td
        colSpan={colSpan}
        className={cn(
          "bg-muted pb-1.5",
          // pt-3.5 (14px) en vez de py-1.5 cuando hay esquina redondeada: tiene que ser
          // >= --radius-xl (14px, ver globals.css) para que el <div> sticky del label
          // nunca arranque dentro de la zona donde el <td> todavía dibuja la curva. Si
          // arranca antes, su fondo bg-muted (plano, sin radius propio) se pinta encima
          // del borde/curva del <td> padre y se ve como una esquina "tapada" en vez de
          // redondeada.
          topOfCard ? "pt-3.5 border-t border-l border-r border-black/[0.08] rounded-t-xl" : "pt-1.5"
        )}
      >
        <div className="sticky left-0 z-10 flex w-fit items-center gap-1.5 bg-muted px-4 text-xs font-medium text-muted-foreground shadow-[1px_0_0_0_hsl(var(--border))]">
          <Icon className="h-3.5 w-3.5 shrink-0" />
          {label}
        </div>
      </td>
    </tr>
  );
}
