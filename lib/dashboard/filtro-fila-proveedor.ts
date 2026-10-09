import type { DetalleFilterExtra } from "./detalle-filter";
import type { PivotProveedorSubRow } from "./types";

type FilaProveedor = Pick<PivotProveedorSubRow, "proveedorId" | "proveedorTexto" | "codigo" | "rubroCodigo">;

// Filtro de drill-down de una fila de proveedor de la vista por proveedor. La fila cuelga de un
// rubro y su total es solo lo de ese rubro: sin rubroCodigo el modal traía las compras del
// proveedor en todos los rubros y sumaba más que la celda clickeada.
export function filtroFilaProveedor(fila: FilaProveedor): DetalleFilterExtra {
  const { rubroCodigo } = fila;
  if (fila.proveedorId != null) return { proveedorId: fila.proveedorId, rubroCodigo };
  if (fila.proveedorTexto != null) {
    return { proveedorTexto: fila.proveedorTexto, codigo: fila.codigo ?? undefined, rubroCodigo };
  }
  return { sinProveedor: true, rubroCodigo };
}
