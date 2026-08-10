import { cn } from "@/lib/utils";
import type { ReactNode } from "react";
import { cardCellClasses, type CardRowPosition } from "@/lib/dashboard/card-row-classes";

interface StickyCardCellProps {
  position: CardRowPosition;
  bg?: string; // color de fondo — va tanto en el <td> como en el <div> interno
  bordered?: boolean; // false quita el borde de la tarjeta pero conserva el redondeo
  roundedTop?: boolean; // false quita puntualmente el redondeo de la esquina superior
  className?: string; // padding/tipografía/hover del contenido, va en el <div> interno
  title?: string;
  children: ReactNode;
}

// Celda sticky de la columna izquierda con borde/esquina de tarjeta. El <td> queda como
// rectángulo 100% opaco y SIN borde propio — combinar position:sticky con un <border> en
// el mismo elemento genera un artefacto de compositing en Chrome que deja pasar el color
// de la celda vecina (el heatmap) por la esquina redondeada. El borde (incluido el recto
// de arriba/abajo) va solo en el <div> interno, que no es sticky.
//
// El <td> SÍ replica el redondeo del <div> (sin borde, vía opts.border:false): el <div> es
// `w-fit` y en filas con esquina puede terminar más angosto que el ancho real de la
// columna, así que el <td> es quien cubre ese resto con su propio fondo opaco. Sin el
// mismo redondeo, ese fondo del <td> es un rectángulo recto que asoma detrás de la curva
// del <div>, tapando el borde en la esquina.
export function StickyCardCell({ position, bg = "bg-background", bordered = true, roundedTop = true, className, title, children }: StickyCardCellProps) {
  return (
    <td
      title={title}
      className={cn(
        "sticky left-0 z-10 p-0 shadow-[1px_0_0_0_hsl(var(--border))]",
        bg,
        cardCellClasses(position, "left", { border: false, roundedTop })
      )}
    >
      <div className={cn("h-full flex items-center", bg, cardCellClasses(position, "left", { border: bordered, roundedTop }), className)}>
        {children}
      </div>
    </td>
  );
}
