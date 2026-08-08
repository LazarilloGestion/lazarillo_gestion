// Con `border-separate` cada <td> mantiene su propio borde/radius, así que una "tarjeta"
// alrededor de un grupo de <tr> se arma aplicando borde/esquinas por celda: la fila de
// arriba del grupo pone border-top, la de abajo border-bottom, la columna sticky de la
// izquierda pone border-left y la de %ing (derecha) border-right — con radius solo en
// las 4 esquinas reales del grupo.
export type CardRowPosition = "first" | "last" | "middle" | "only";
export type CardCellEdge = "left" | "right" | "mid";

const BORDER = "border-black/[0.08]";

export function cardCellClasses(position: CardRowPosition, edge: CardCellEdge): string {
  const isTop = position === "first" || position === "only";
  const isBottom = position === "last" || position === "only";
  const classes = [
    isTop && `border-t ${BORDER}`,
    isBottom && `border-b ${BORDER}`,
    edge === "left" && `border-l ${BORDER}`,
    edge === "right" && `border-r ${BORDER}`,
    isTop && edge === "left" && "rounded-tl-xl",
    isTop && edge === "right" && "rounded-tr-xl",
    isBottom && edge === "left" && "rounded-bl-xl",
    isBottom && edge === "right" && "rounded-br-xl",
  ];
  return classes.filter(Boolean).join(" ");
}

// Fila espaciadora entre tarjetas — separa visualmente sin bordes propios.
export const CARD_GAP_HEIGHT = "h-2.5";
