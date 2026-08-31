import { describe, it, expect } from "vitest";
import { buildComposicion } from "./apertura-composicion";

describe("buildComposicion", () => {
  it("agrupa por concepto+mes y arma la lista de destinos con pct e importe", () => {
    const destinoRows = [
      { concepto_codigo: "17", mes: 5, destino_nombre: "Actual", pct: 70, importe_calculado: 73993 },
      { concepto_codigo: "17", mes: 5, destino_nombre: "Canchas Ramos", pct: 10, importe_calculado: 10570 },
      { concepto_codigo: "17", mes: 5, destino_nombre: "Canchas SJ", pct: 10, importe_calculado: 10570 },
      { concepto_codigo: "17", mes: 5, destino_nombre: "Descartado", pct: 10, importe_calculado: 10571 },
    ];
    const originalRows = [{ concepto_codigo: "17", mes: 5, importe_original: 105704 }];
    const result = buildComposicion(destinoRows, originalRows);
    expect(result["17"][5].total).toBe(105704);
    expect(result["17"][5].destinos).toHaveLength(4);
    expect(result["17"][5].destinos[0]).toEqual({ nombre: "Actual", pct: 70, importe: 73993 });
  });

  it("convierte Decimal-like (string) a number", () => {
    const result = buildComposicion(
      [{ concepto_codigo: "3", mes: 1, destino_nombre: "X", pct: "50.00", importe_calculado: "1000.00" }],
      [{ concepto_codigo: "3", mes: 1, importe_original: "2000.00" }]
    );
    expect(result["3"][1].destinos[0]).toEqual({ nombre: "X", pct: 50, importe: 1000 });
    expect(result["3"][1].total).toBe(2000);
  });

  it("concepto+mes sin fila de original: total 0 (no rompe)", () => {
    const result = buildComposicion(
      [{ concepto_codigo: "9", mes: 2, destino_nombre: "X", pct: 100, importe_calculado: 5 }],
      []
    );
    expect(result["9"][2].total).toBe(0);
  });
});
