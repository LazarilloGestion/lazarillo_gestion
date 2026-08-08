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
        className={cn("bg-muted py-1.5", topOfCard && "border-t border-l border-r border-black/[0.08] rounded-t-xl")}
      >
        <div className="sticky left-0 z-10 flex w-fit items-center gap-1.5 bg-muted px-4 text-xs font-medium text-muted-foreground shadow-[1px_0_0_0_hsl(var(--border))]">
          <Icon className="h-3.5 w-3.5 shrink-0" />
          {label}
        </div>
      </td>
    </tr>
  );
}
