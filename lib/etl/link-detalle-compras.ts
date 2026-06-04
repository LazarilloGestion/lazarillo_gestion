import type { DbClient } from "./types";
import { linkDetalleComprasByComprobante } from "./normalizer-utils";

export async function linkDetalleCompras(db: DbClient, localId?: number) {
  if (localId == null) return;
  await linkDetalleComprasByComprobante(db, localId);
}
