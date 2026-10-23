import type { Prisma } from "@prisma/client";

export interface DetalleSqlRow {
  rowId: string;
  distribucionId: number | null;
  esDistribuido: boolean;
  // Total de la compra base (COALESCE importeManual/importe) — en una fila de
  // fan-out `importe` es solo la fracción del destino.
  importeBase: Prisma.Decimal | null;
  fecha: Date | null;
  fechaManual: Date | null;
  importe: Prisma.Decimal | null;
  importeManual: Prisma.Decimal | null;
  conceptoCodigoManual: string | null;
  concepto: string | null;
  detalle: string | null;
  observac: string | null;
  observacManual: string | null;
  proveedorTexto: string | null;
  proveedorId: number | null;
  proveedorNombre: string | null;
  proveedorRazon: string | null;
  localNombre: string | null;
  pdvNombre: string | null;
  localIdOrigen: number | null;
  puntoDeVentaIdOrigen: number | null;
  conceptoCajaCodigo: string | null;
  conceptoCajaNombre: string | null;
  conceptoCajaRubroNombre: string | null;
  conceptoCajaManualCodigo: string | null;
  conceptoCajaManualNombre: string | null;
  conceptoCajaManualRubroNombre: string | null;
  comprobante: string | null;
  codigoProveedor: string | null;
  pdvCompraId: number | null;
}

export function reshapeDetalle(r: DetalleSqlRow) {
  return {
    rowId: r.rowId,
    // distribucionId: null cuando la compra no está distribuida (100% de los
    // casos hasta que exista una regla activa — Fase B no la puede crear sin
    // pasar por la API, ver Task 9). rowId se mantiene SIEMPRE como el de la
    // compra original (no un compuesto) — compra-lineas/[compraId] y el
    // endpoint puntual de compras/[rowId] siguen necesitando el rowId real
    // para funcionar. Fase C es quien debe usar `distribucionId ?? rowId`
    // como key de UI una vez que existan filas distribuidas (riesgo anotado
    // en la sección 4 del diseño, "Riesgo para Fase C").
    distribucionId: r.distribucionId,
    esDistribuido: r.esDistribuido,
    fecha: r.fecha,
    importe: r.importe,
    importeBase: r.importeBase,
    importeManual: r.importeManual,
    fechaManual: r.fechaManual,
    conceptoCodigoManual: r.conceptoCodigoManual,
    concepto: r.concepto,
    detalle: r.detalle,
    observac: r.observac,
    observacManual: r.observacManual,
    proveedor: r.proveedorTexto,
    proveedorRef: r.proveedorId != null ? { id: r.proveedorId, nombre: r.proveedorNombre, razon: r.proveedorRazon } : null,
    local: r.localNombre != null ? { nombre: r.localNombre } : null,
    puntoDeVenta: r.pdvNombre != null ? { nombre: r.pdvNombre } : null,
    comprobante: r.comprobante,
    codigoProveedor: r.codigoProveedor,
    pdvCompraId: r.pdvCompraId,
    localIdOrigen: r.localIdOrigen,
    puntoDeVentaIdOrigen: r.puntoDeVentaIdOrigen,
    conceptoCaja:
      r.conceptoCajaCodigo != null
        ? { codigo: r.conceptoCajaCodigo, nombre: r.conceptoCajaNombre, rubro: r.conceptoCajaRubroNombre != null ? { nombre: r.conceptoCajaRubroNombre } : null }
        : null,
    conceptoCajaManual:
      r.conceptoCajaManualCodigo != null
        ? {
            codigo: r.conceptoCajaManualCodigo,
            nombre: r.conceptoCajaManualNombre,
            rubro: r.conceptoCajaManualRubroNombre != null ? { nombre: r.conceptoCajaManualRubroNombre } : null,
          }
        : null,
  };
}
