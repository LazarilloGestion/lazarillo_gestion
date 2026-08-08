import { cn } from "@/lib/utils";
import type { ReactNode } from "react";
import { cardCellClasses, type CardRowPosition } from "@/lib/dashboard/card-row-classes";

interface StickyCardCellProps {
  position: CardRowPosition;
  bg?: string; // color de fondo — va tanto en el <td> como en el <div> interno
  className?: string; // padding/tipografía/hover del contenido, va en el <div> interno
  title?: string;
  children: ReactNode;
}

// Celda sticky de la columna izquierda con borde/esquina de tarjeta. El <td> queda como
// rectángulo 100% opaco y SIN radius — combinar position:sticky con border-radius en el
// mismo elemento genera un artefacto de compositing en Chrome que deja pasar el color de
// la celda vecina (el heatmap) por la esquina redondeada. El borde izquierdo y el
// redondeo van en el <div> interno, que no es sticky y queda totalmente cubierto por el
// fondo opaco del <td>, así no hay nada detrás que se pueda colar.
export function StickyCardCell({ position, bg = "bg-background", className, title, children }: StickyCardCellProps) {
  return (
    <td
      title={title}
      className={cn("sticky left-0 z-10 p-0 shadow-[1px_0_0_0_hsl(var(--border))]", bg, cardCellClasses(position, "mid"))}
    >
      <div className={cn("h-full flex items-center", bg, cardCellClasses(position, "left"), className)}>
        {children}
      </div>
    </td>
  );
}
