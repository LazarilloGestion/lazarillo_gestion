import { describe, it, expect } from "vitest";
import { planCleanupDuplicados, type CompraParaLimpieza } from "./cleanup-duplicados-compras";
import { computeCompraRowId, compraIdentityFromDbRecord } from "../lib/etl/normalizers/compra-identity";

const BASE = {
  codCga: "GASTO1",
  fecha: new Date("2026-04-16"),
  codigo: "PROV1",
  concepto: "Packaging",
  comprobante: "A000200076930",
  detalle: "A  0002-00076930",
  observac: "Porta Cinta",
  importe: { toString: () => "49399.99" },
};

function rowIdNuevoPara(datos: typeof BASE): string {
  return computeCompraRowId(compraIdentityFromDbRecord(datos));
}

function filaNueva(overrides: Partial<CompraParaLimpieza> = {}): CompraParaLimpieza {
  return {
    ...BASE,
    rowId: rowIdNuevoPara(BASE),
    esDistribuido: false,
    tieneDetalleCompras: false,
    ...overrides,
  };
}

function filaVieja(overrides: Partial<CompraParaLimpieza> = {}): CompraParaLimpieza {
  return {
    ...BASE,
    rowId: "hash-esquema-viejo-1",
    esDistribuido: false,
    tieneDetalleCompras: false,
    ...overrides,
  };
}

describe("planCleanupDuplicados", () => {
  it("grupo limpio de 1 vieja + 1 nueva: la vieja va a rowIdABorrar", () => {
    const plan = planCleanupDuplicados([filaVieja(), filaNueva()]);
    expect(plan.rowIdABorrar).toEqual(["hash-esquema-viejo-1"]);
    expect(plan.gruposExcluidos).toHaveLength(0);
  });

  it("candidata a borrar con esDistribuido=true: grupo excluido, no se borra nada", () => {
    const plan = planCleanupDuplicados([filaVieja({ esDistribuido: true }), filaNueva()]);
    expect(plan.rowIdABorrar).toHaveLength(0);
    expect(plan.gruposExcluidos).toHaveLength(1);
    expect(plan.gruposExcluidos[0].motivo).toBe("la fila candidata a borrar tiene esDistribuido=true");
  });

  it("candidata a borrar con tieneDetalleCompras=true: grupo excluido", () => {
    const plan = planCleanupDuplicados([filaVieja({ tieneDetalleCompras: true }), filaNueva()]);
    expect(plan.rowIdABorrar).toHaveLength(0);
    expect(plan.gruposExcluidos).toHaveLength(1);
    expect(plan.gruposExcluidos[0].motivo).toBe("la fila candidata a borrar tiene detalle_compras propio");
  });

  it("grupo con 3 filas: excluido por forma inesperada", () => {
    const plan = planCleanupDuplicados([
      filaVieja({ rowId: "hash-viejo-a" }),
      filaVieja({ rowId: "hash-viejo-b" }),
      filaNueva(),
    ]);
    expect(plan.rowIdABorrar).toHaveLength(0);
    expect(plan.gruposExcluidos).toHaveLength(1);
    expect(plan.gruposExcluidos[0].motivo).toBe("forma inesperada (no es 1 vieja + 1 nueva)");
  });

  it("dos filas que matchean AMBAS el esquema nuevo: excluido por forma inesperada", () => {
    const plan = planCleanupDuplicados([filaNueva(), filaNueva()]);
    expect(plan.rowIdABorrar).toHaveLength(0);
    expect(plan.gruposExcluidos).toHaveLength(1);
    expect(plan.gruposExcluidos[0].motivo).toBe("forma inesperada (no es 1 vieja + 1 nueva)");
  });

  it("sin duplicados (compras de grupos distintos): rowIdABorrar vacío, sin exclusiones", () => {
    const otra = filaNueva({
      rowId: rowIdNuevoPara({ ...BASE, codigo: "PROV2" }),
      codigo: "PROV2",
    });
    const plan = planCleanupDuplicados([filaNueva(), otra]);
    expect(plan.rowIdABorrar).toHaveLength(0);
    expect(plan.gruposExcluidos).toHaveLength(0);
  });
});
