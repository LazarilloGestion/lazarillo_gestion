// Con `border-separate` cada <td> mantiene su propio borde/radius, así que una "tarjeta"
// alrededor de un grupo de <tr> se arma aplicando borde/esquinas por celda: la fila de
// arriba del grupo pone border-top, la de abajo border-bottom, la columna sticky de la
// izquierda pone border-left y la de %ing (derecha) border-right — con radius solo en
// las 4 esquinas reales del grupo.
export type CardRowPosition = "first" | "last" | "middle" | "only";
export type CardCellEdge = "left" | "right" | "mid";

const BORDER = "border-black/[0.08]";

// `border` en false quita las líneas de borde pero conserva el redondeo de esquinas —
// algunas tarjetas (p.ej. Compras) quieren el contenedor sin borde sin perder la forma.
// `roundedTop` en false quita puntualmente el redondeo de arriba (p.ej. Resultados: la fila
// de Ingresos queda pegada al header de la tabla, sin esquina).
export function cardCellClasses(
  position: CardRowPosition,
  edge: CardCellEdge,
  opts?: { border?: boolean; roundedTop?: boolean },
): string {
  const border = opts?.border ?? true;
  const roundedTop = opts?.roundedTop ?? true;
  const isTop = position === "first" || position === "only";
  const isBottom = position === "last" || position === "only";
  const classes = [
    border && isTop && `border-t ${BORDER}`,
    border && isBottom && `border-b ${BORDER}`,
    border && edge === "left" && `border-l ${BORDER}`,
    border && edge === "right" && `border-r ${BORDER}`,
    isTop && roundedTop && edge === "left" && "rounded-tl-xl",
    isTop && roundedTop && edge === "right" && "rounded-tr-xl",
    isBottom && edge === "left" && "rounded-bl-xl",
    isBottom && edge === "right" && "rounded-br-xl",
  ];
  return classes.filter(Boolean).join(" ");
}

// Fila espaciadora entre tarjetas — separa visualmente sin bordes propios.
export const CARD_GAP_HEIGHT = "h-2.5";
