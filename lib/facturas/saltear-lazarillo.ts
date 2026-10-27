import type { DbClient } from "@/lib/etl/types";

// Comprobantes cargados desde el Panel (origen 'lazarillo') para un local:
// el import de MaxiRest (14 y 25) los saltea — gana lo de Lazarillo y no se
// duplica (Diego, 26/10/2026: un tiempo se carga en los dos lados).
//
// Clave de comparación (revisión 27/10/2026):
//  - Notas de crédito: MaxiRest exporta "NC  0004-…" (manual) o "NcA 0004-…"
//    (electrónica) y Lazarillo guarda "NC…": se comparan sin la letra.
//  - Tickets (Z / "Tic"): el número NO es único (MaxiRest repite números en compras
//    distintas), así que además del número y el proveedor tiene que coincidir la
//    fecha; si no, se importa (mejor ver dos que perder una compra real).

export const normalizarComprobante = (c: string) => c.toUpperCase().replace(/^NC[ABC]?/, "NC");
export const esTicket = (c: string) => /^Z/i.test(c);

export function claveSalteo(comprobante: string, codigo: string | null | undefined, fechaISO: string | null | undefined): string {
  const cpb = normalizarComprobante(comprobante);
  return esTicket(cpb) ? `${cpb}|${codigo ?? ""}|${(fechaISO ?? "").slice(0, 10)}` : `${cpb}|${codigo ?? ""}`;
}

// Variantes de un comprobante tal como pueden estar guardadas (NC, NCA, NCB, NCC).
function variantes(c: string): string[] {
  const n = normalizarComprobante(c);
  return n.startsWith("NC") ? [n, `NCA${n.slice(2)}`, `NCB${n.slice(2)}`, `NCC${n.slice(2)}`] : [n];
}

const iso = (f: Date | null | undefined) => (f ? f.toISOString().slice(0, 10) : null);

export async function comprobantesDeLazarillo(
  prisma: DbClient,
  tabla: "compras" | "detalle",
  localId: number | null | undefined,
  comprobantes: string[],
): Promise<Set<string>> {
  const unicos = [...new Set(comprobantes.filter(Boolean).flatMap(variantes))];
  if (localId == null || unicos.length === 0) return new Set();
  if (tabla === "compras") {
    const filas = await prisma.compra.findMany({
      where: { origen: "lazarillo", localId, comprobante: { in: unicos } },
      select: { comprobante: true, codigo: true, fecha: true },
    });
    return new Set(filas.map((f) => claveSalteo(f.comprobante ?? "", f.codigo, iso(f.fecha))));
  }
  const filas = await prisma.detalleCompra.findMany({
    where: { origen: "lazarillo", localId, comprobante: { in: unicos } },
    select: { comprobante: true, codPro: true, fecha: true },
  });
  return new Set(filas.map((f) => claveSalteo(f.comprobante ?? "", f.codPro, iso(f.fecha))));
}
