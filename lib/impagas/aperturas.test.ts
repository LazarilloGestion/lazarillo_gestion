import { describe, it, expect } from "vitest";
import {
  aCuenta, agruparEmpleados, formatearImporteAR, imputarFifo, importeAInput, normalizarReferencia, parsearImporteAR,
  porMes, saldoDeuda, type DeudaConPdv, type MovimientoApertura,
} from "./aperturas";

const mov = (key: string, fecha: string, importe: number, aplicado = 0): MovimientoApertura => ({
  key, fecha, comprobante: null, proveedor: "X", concepto: "", porcentaje: 50, importe, aplicado,
});

describe("imputar un pago a lo más viejo primero", () => {
  const movs = [mov("c", "2026-10-01", 300), mov("a", "2026-09-01", 100), mov("b", "2026-09-15", 200, 50)];
  it("menor que la deuda: el último queda parcial", () => {
    const r = imputarFifo(movs, 200);
    expect(r.aplicaciones).toEqual([{ key: "a", importe: 100 }, { key: "b", importe: 100 }]);
    expect(r.sobrante).toBe(0);
  });
  it("mayor que la deuda: el excedente queda a cuenta", () => {
    const r = imputarFifo(movs, 1000);
    expect(r.aplicaciones.map((x) => x.importe)).toEqual([100, 150, 300]);
    expect(r.sobrante).toBe(450);
  });
  it("respeta centavos", () => {
    expect(imputarFifo([mov("a", "2026-09-01", 10.1)], 10.05).aplicaciones[0].importe).toBe(10.05);
  });
});

describe("saldo de la deuda con el PDV", () => {
  it("resta lo imputado y lo que quedó a cuenta", () => {
    const d: DeudaConPdv = {
      pdvOrigenId: 1,
      movimientos: [mov("a", "2026-09-01", 100, 100), mov("b", "2026-09-02", 200)],
      pagos: [{ id: 1, fecha: "2026-10-01", importe: 150, medio: "Caja Mayor", referencia: null, aplicado: 100, movimientos: 1 }],
    };
    expect(aCuenta(d)).toBe(50);
    expect(saldoDeuda(d)).toBe(150);
  });
  it("agrupa por mes", () => {
    const m = porMes([mov("b", "2026-10-02", 5), mov("a", "2026-09-30", 7, 2)]);
    expect(m.map((x) => [x.mes, x.total, x.saldo])).toEqual([["2026-10", 5, 5], ["2026-09", 7, 5]]);
  });
});

describe("sueldos agrupados por empleado dentro del mes", () => {
  it("junta los conceptos de cada empleado y deja el resto suelto", () => {
    const emp = (key: string, nombre: string, importe: number, aplicado = 0) =>
      ({ ...mov(key, "2026-10-21", importe, aplicado), proveedor: nombre, esEmpleado: true });
    const filas = agruparEmpleados([
      emp("1", "Lautaro Ruben Zuccala", 282630), mov("gv", "2026-10-16", 431351),
      emp("2", "Camila Cancino", 637190), emp("3", "Lautaro Ruben Zuccala", 35640, 35640),
    ]);
    expect(filas.map((f) => (f.tipo === "mov" ? f.mov.key : `${f.nombre}:${f.movimientos.length}`)))
      .toEqual(["Lautaro Ruben Zuccala:2", "gv", "Camila Cancino:1"]);
    const l = filas[0];
    expect(l.tipo === "empleado" && [l.total, l.saldo, l.aplicado]).toEqual([318270, 282630, 35640]);
  });
});

describe("importe en formato moneda e ID de transferencia", () => {
  it("formatea mientras se tipea y parsea de vuelta", () => {
    expect(formatearImporteAR("1234567")).toBe("$ 1.234.567");
    expect(formatearImporteAR("$ 1.234.567,895")).toBe("$ 1.234.567,89");
    expect(formatearImporteAR("0012,5")).toBe("$ 12,5");
    expect(parsearImporteAR("$ 1.234.567,89")).toBe(1234567.89);
    expect(parsearImporteAR("")).toBeNull();
    expect(importeAInput(32942565.4)).toBe("$ 32.942.565,40");
    expect(importeAInput(1000)).toBe("$ 1.000");
  });
  it("ID alfanumérico, largo, sin espacios", () => {
    expect(normalizarReferencia(" abc123 XYZ ")).toBe("ABC123XYZ");
    expect(normalizarReferencia("0000003100012345678901234")).toHaveLength(25);
    expect(normalizarReferencia("12-34")).toBeNull();
    expect(normalizarReferencia("")).toBeNull();
  });
});
