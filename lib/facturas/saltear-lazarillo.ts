import type { DbClient } from "@/lib/etl/types";

// Comprobantes cargados desde el Panel (origen 'lazarillo') para un local:
// el import de MaxiRest (14 y 25) los saltea — gana lo de Lazarillo y no se
// duplica (Diego, 26/10/2026: un tiempo se carga en los dos lados).
// Clave = comprobante | código de proveedor del ERP.
export async function comprobantesDeLazarillo(
  prisma: DbClient,
  tabla: "compras" | "detalle",
  localId: number | null | undefined,
  comprobantes: string[],
): Promise<Set<string>> {
  const unicos = [...new Set(comprobantes.filter(Boolean))];
  if (localId == null || unicos.length === 0) return new Set();
  if (tabla === "compras") {
    const filas = await prisma.compra.findMany({
      where: { origen: "lazarillo", localId, comprobante: { in: unicos } },
      select: { comprobante: true, codigo: true },
    });
    return new Set(filas.map((f) => `${f.comprobante}|${f.codigo ?? ""}`));
  }
  const filas = await prisma.detalleCompra.findMany({
    where: { origen: "lazarillo", localId, comprobante: { in: unicos } },
    select: { comprobante: true, codPro: true },
  });
  return new Set(filas.map((f) => `${f.comprobante}|${f.codPro ?? ""}`));
}
