import { origenAlcanza } from "./validaciones";
import { fechaEnVigencia, type ReglaVigencia } from "./vigencia";
import { revertirCompra, aplicarReglaACompra, type AperturaDbClient } from "./motor";
import { normalizarProveedorTexto } from "../text-normalize";

export type ReglaCandidata = {
  id: number;
  modo: ReglaVigencia["modo"];
  fechaDesde: Date | null;
  fechaHasta: Date | null;
  extremosInclusivos: boolean;
  origenLocalId: number | null;
  origenPuntoDeVentaId: number | null;
  destinos: { id: number; porcentaje: number }[];
};

// Pura: entre las reglas activas del concepto efectivo de una compra, elige la
// que la cubre (origen alcanza su ubicación + vigencia cubre su fecha). Por el
// invariante de no-superposición hay a lo sumo una; si hubiera varias, gana la
// primera (orden del caller) — mismo criterio determinístico que
// encontrarSuperposicion.
export function elegirReglaParaCompra(
  ubicacion: { localId: number | null; puntoDeVentaId: number | null },
  fechaEfectiva: Date,
  reglas: ReglaCandidata[]
): ReglaCandidata | null {
  return (
    reglas.find(
      (r) =>
        origenAlcanza(
          { localId: r.origenLocalId, puntoDeVentaId: r.origenPuntoDeVentaId },
          ubicacion
        ) &&
        fechaEnVigencia(fechaEfectiva, {
          modo: r.modo,
          fechaDesde: r.fechaDesde,
          fechaHasta: r.fechaHasta,
          extremosInclusivos: r.extremosInclusivos,
        })
    ) ?? null
  );
}

// Mismo criterio que condicionMatchNivel (lib/apertura/motor.ts) para nivel
// "proveedor" — extraída como función pura para poder testearla sin Prisma, y
// para que este archivo y el motor NUNCA puedan resolver un entidadId distinto
// para la misma compra.
export function resolverEntidadIdProveedor(compra: { proveedorId: number | null; proveedor: string | null }): string {
  if (compra.proveedorId != null) return String(compra.proveedorId);
  return `texto:${normalizarProveedorTexto(compra.proveedor)}`;
}

// Orquestación: revierte la distribución vieja de la compra y le aplica la
// regla activa que corresponda a su estado ACTUAL (concepto/fecha/local
// efectivos). SIEMPRE dentro de una $transaction (igual que el resto del
// motor — el caller, Task 11, la envuelve). Devuelve si se reevaluó y si quedó
// distribuida.
//
// El revertirCompra va SIEMPRE y ANTES de cualquier aplicarReglaACompra:
// aplicarReglaACompra no es idempotente (hace INSERT a ciegas), así que sin
// revertir primero una segunda reevaluación duplicaría las distribuciones
// (hallazgo de la revisión de Task 7).
export async function reevaluarCompra(
  prisma: AperturaDbClient,
  rowId: string
): Promise<{ reevaluada: boolean; distribuidaAhora: boolean }> {
  const compra = await prisma.compra.findUnique({
    where: { rowId },
    select: {
      localId: true, puntoDeVentaId: true,
      fecha: true, fechaManual: true,
      importe: true, importeManual: true,
      conceptoCodigo: true, conceptoCodigoManual: true,
      proveedorId: true, proveedor: true,
    },
  });
  if (!compra) return { reevaluada: false, distribuidaAhora: false };

  await revertirCompra(prisma, rowId);

  const conceptoEfectivo = compra.conceptoCodigoManual ?? compra.conceptoCodigo;
  const fechaEfectiva = compra.fechaManual ?? compra.fecha;
  const importeEfectivo = compra.importeManual ?? compra.importe;
  if (!fechaEfectiva || importeEfectivo == null) {
    return { reevaluada: true, distribuidaAhora: false };
  }

  // Orden de prioridad fijo: registro > proveedor > concepto (spec v2). Una
  // compra sin concepto efectivo (dato ausente) simplemente no tiene
  // candidatas de ese nivel — no es motivo para cortar antes, a diferencia de
  // v1 donde concepto era el único nivel posible.
  const nivelesAProbar: { nivel: string; entidadId: string | null }[] = [
    { nivel: "registro", entidadId: rowId },
    { nivel: "proveedor", entidadId: resolverEntidadIdProveedor(compra) },
    { nivel: "concepto", entidadId: conceptoEfectivo ?? null },
  ];

  let regla: ReglaCandidata | null = null;
  for (const { nivel, entidadId } of nivelesAProbar) {
    if (entidadId == null) continue;
    const candidatas = await prisma.reglaApertura.findMany({
      where: { estado: "activa", nivel, entidadId },
      select: {
        id: true, modo: true, fechaDesde: true, fechaHasta: true, extremosInclusivos: true,
        origenLocalId: true, origenPuntoDeVentaId: true,
        destinos: { select: { id: true, porcentaje: true } },
      },
    });
    regla = elegirReglaParaCompra(
      { localId: compra.localId, puntoDeVentaId: compra.puntoDeVentaId },
      fechaEfectiva,
      candidatas.map((r) => ({
        id: r.id,
        modo: r.modo as ReglaVigencia["modo"],
        fechaDesde: r.fechaDesde,
        fechaHasta: r.fechaHasta,
        extremosInclusivos: r.extremosInclusivos,
        origenLocalId: r.origenLocalId,
        origenPuntoDeVentaId: r.origenPuntoDeVentaId,
        destinos: r.destinos.map((d) => ({ id: d.id, porcentaje: Number(d.porcentaje.toString()) })),
      }))
    );
    if (regla) break;
  }
  if (!regla) return { reevaluada: true, distribuidaAhora: false };

  await aplicarReglaACompra(prisma, {
    reglaId: regla.id,
    rowId,
    // Number(x.toString()), no Number(x) directo — mismo patrón que motor.ts.
    importeBase: Math.round(Number(importeEfectivo.toString()) * 100) / 100,
    destinos: regla.destinos,
  });
  return { reevaluada: true, distribuidaAhora: true };
}
