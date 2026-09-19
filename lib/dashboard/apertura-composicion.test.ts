import { describe, it, expect } from "vitest";
import { buildComposicion, buildComposicionPorProveedor } from "./apertura-composicion";

describe("buildComposicion", () => {
  it("agrupa por concepto+mes y arma la lista de destinos con pct e importe", () => {
    const destinoRows = [
      { concepto_codigo: "17", proveedor_id: 1, proveedor_nombre: "Proveedor A", mes: 5, destino_nombre: "Actual", pct: 70, importe_calculado: 73993 },
      { concepto_codigo: "17", proveedor_id: 1, proveedor_nombre: "Proveedor A", mes: 5, destino_nombre: "Canchas Ramos", pct: 10, importe_calculado: 10570 },
      { concepto_codigo: "17", proveedor_id: 1, proveedor_nombre: "Proveedor A", mes: 5, destino_nombre: "Canchas SJ", pct: 10, importe_calculado: 10570 },
      { concepto_codigo: "17", proveedor_id: 1, proveedor_nombre: "Proveedor A", mes: 5, destino_nombre: "Descartado", pct: 10, importe_calculado: 10571 },
    ];
    const originalRows = [{ concepto_codigo: "17", proveedor_id: 1, proveedor_nombre: "Proveedor A", mes: 5, importe_original: 105704 }];
    const result = buildComposicion(destinoRows, originalRows);
    expect(result["17"][5].total).toBe(105704);
    expect(result["17"][5].destinos).toHaveLength(4);
    expect(result["17"][5].destinos[0]).toEqual({ nombre: "Actual", pct: 70, importe: 73993 });
  });

  it("convierte Decimal-like (string) a number", () => {
    const result = buildComposicion(
      [{ concepto_codigo: "3", proveedor_id: 1, proveedor_nombre: "Proveedor A", mes: 1, destino_nombre: "X", pct: "50.00", importe_calculado: "1000.00" }],
      [{ concepto_codigo: "3", proveedor_id: 1, proveedor_nombre: "Proveedor A", mes: 1, importe_original: "2000.00" }]
    );
    expect(result["3"][1].destinos[0]).toEqual({ nombre: "X", pct: 50, importe: 1000 });
    expect(result["3"][1].total).toBe(2000);
  });

  it("concepto+mes sin fila de original: total 0 (no rompe)", () => {
    const result = buildComposicion(
      [{ concepto_codigo: "9", proveedor_id: 1, proveedor_nombre: "Proveedor A", mes: 2, destino_nombre: "X", pct: 100, importe_calculado: 5 }],
      []
    );
    expect(result["9"][2].total).toBe(0);
  });

  it("fusiona destinos con mismo nombre+pct cuando la SQL llega particionada por proveedor, sumando el importe", () => {
    const destinoRows = [
      { concepto_codigo: "17", proveedor_id: 1, proveedor_nombre: "Proveedor A", mes: 5, destino_nombre: "Actual", pct: 70, importe_calculado: 40000 },
      { concepto_codigo: "17", proveedor_id: 2, proveedor_nombre: "Proveedor B", mes: 5, destino_nombre: "Actual", pct: 70, importe_calculado: 33993 },
    ];
    const originalRows = [{ concepto_codigo: "17", proveedor_id: null, proveedor_nombre: "Sin Proveedor", mes: 5, importe_original: 105704 }];
    const result = buildComposicion(destinoRows, originalRows);
    expect(result["17"][5].destinos).toHaveLength(1);
    expect(result["17"][5].destinos[0]).toEqual({ nombre: "Actual", pct: 70, importe: 73993 });
  });
});

describe("buildComposicionPorProveedor", () => {
  it("agrupa por concepto+proveedor+mes, sin mezclar proveedores", () => {
    const destinoRows = [
      { concepto_codigo: "17", proveedor_id: 1, proveedor_nombre: "Proveedor A", mes: 5, destino_nombre: "Actual", pct: 70, importe_calculado: 700 },
      { concepto_codigo: "17", proveedor_id: 2, proveedor_nombre: "Proveedor B", mes: 5, destino_nombre: "Actual", pct: 50, importe_calculado: 500 },
    ];
    const originalRows = [
      { concepto_codigo: "17", proveedor_id: 1, proveedor_nombre: "Proveedor A", mes: 5, importe_original: 1000 },
      { concepto_codigo: "17", proveedor_id: 2, proveedor_nombre: "Proveedor B", mes: 5, importe_original: 1000 },
    ];
    const result = buildComposicionPorProveedor(destinoRows, originalRows);

    expect(result["17|1"][5].total).toBe(1000);
    expect(result["17|1"][5].destinos).toEqual([{ nombre: "Actual", pct: 70, importe: 700 }]);
    expect(result["17|2"][5].destinos).toEqual([{ nombre: "Actual", pct: 50, importe: 500 }]);
  });

  it("proveedor_id null: usa el texto crudo normalizado como clave, no un sentinela fijo", () => {
    const result = buildComposicionPorProveedor(
      [{ concepto_codigo: "3", proveedor_id: null, proveedor_nombre: "Diego", mes: 1, destino_nombre: "X", pct: 100, importe_calculado: 500 }],
      [{ concepto_codigo: "3", proveedor_id: null, proveedor_nombre: "Diego", mes: 1, importe_original: 500 }]
    );
    expect(result["3|texto:diego"][1].total).toBe(500);
  });

  it("dos textos crudos distintos sin proveedor real, mismo concepto: NO se mezclan en la misma composición", () => {
    const destinoRows = [
      { concepto_codigo: "3", proveedor_id: null, proveedor_nombre: "Diego", mes: 1, destino_nombre: "Local A", pct: 100, importe_calculado: 100 },
      { concepto_codigo: "3", proveedor_id: null, proveedor_nombre: "GASTOS VARIOS", mes: 1, destino_nombre: "Local B", pct: 100, importe_calculado: 200 },
    ];
    const originalRows = [
      { concepto_codigo: "3", proveedor_id: null, proveedor_nombre: "Diego", mes: 1, importe_original: 100 },
      { concepto_codigo: "3", proveedor_id: null, proveedor_nombre: "GASTOS VARIOS", mes: 1, importe_original: 200 },
    ];
    const result = buildComposicionPorProveedor(destinoRows, originalRows);
    expect(result["3|texto:diego"][1].destinos).toEqual([{ nombre: "Local A", pct: 100, importe: 100 }]);
    expect(result["3|texto:gastosvarios"][1].destinos).toEqual([{ nombre: "Local B", pct: 100, importe: 200 }]);
  });

  it("no afecta a buildComposicion existente (sigue agrupando solo por concepto)", () => {
    const result = buildComposicion(
      [{ concepto_codigo: "17", proveedor_id: 1, proveedor_nombre: "Proveedor A", mes: 5, destino_nombre: "Actual", pct: 70, importe_calculado: 700 }],
      [{ concepto_codigo: "17", proveedor_id: 1, proveedor_nombre: "Proveedor A", mes: 5, importe_original: 1000 }]
    );
    expect(result["17"][5].total).toBe(1000);
  });

  it("NO fusiona dos destinos distintos del mismo bucket (concepto+proveedor+mes) aunque compartan pct", () => {
    const destinoRows = [
      { concepto_codigo: "17", proveedor_id: 1, proveedor_nombre: "Proveedor A", mes: 5, destino_nombre: "Actual", pct: 70, importe_calculado: 700 },
      { concepto_codigo: "17", proveedor_id: 1, proveedor_nombre: "Proveedor A", mes: 5, destino_nombre: "Canchas Ramos", pct: 70, importe_calculado: 300 },
    ];
    const originalRows = [{ concepto_codigo: "17", proveedor_id: 1, proveedor_nombre: "Proveedor A", mes: 5, importe_original: 1000 }];
    const result = buildComposicionPorProveedor(destinoRows, originalRows);

    expect(result["17|1"][5].destinos).toHaveLength(2);
    expect(result["17|1"][5].destinos).toEqual([
      { nombre: "Actual", pct: 70, importe: 700 },
      { nombre: "Canchas Ramos", pct: 70, importe: 300 },
    ]);
  });

  it("fusiona el mismo destino de un proveedor real fragmentado en varios proveedor_nombre (maestro sin nombre ni razón)", () => {
    // Un proveedor real cuyo registro maestro no tiene nombre NI razón hace que
    // el COALESCE de la SQL caiga a c.proveedor, que varía fila a fila: el
    // GROUP BY por proveedor_nombre parte un único proveedor_id en varias filas.
    const destinoRows = [
      { concepto_codigo: "17", proveedor_id: 5, proveedor_nombre: "Diego", mes: 5, destino_nombre: "Actual", pct: 70, importe_calculado: 400 },
      { concepto_codigo: "17", proveedor_id: 5, proveedor_nombre: "diego", mes: 5, destino_nombre: "Actual", pct: 70, importe_calculado: 300 },
    ];
    const originalRows = [{ concepto_codigo: "17", proveedor_id: 5, proveedor_nombre: "Diego", mes: 5, importe_original: 1000 }];
    const result = buildComposicionPorProveedor(destinoRows, originalRows);

    expect(result["17|5"][5].destinos).toHaveLength(1);
    expect(result["17|5"][5].destinos[0]).toEqual({ nombre: "Actual", pct: 70, importe: 700 });
    expect(result["17|5"][5].total).toBe(1000);
  });
});
