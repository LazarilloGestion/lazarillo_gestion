import { describe, it, expect } from "vitest";
import { planLimpiezaDistribuciones, type FilaDistribucion } from "./limpiar-distribuciones-duplicadas";

let siguienteId = 1;
function fila(over: Partial<FilaDistribucion> & Pick<FilaDistribucion, "compraRowId" | "destinoId">): FilaDistribucion {
  return {
    id: siguienteId++,
    reglaId: 1,
    importeOriginal: "1000.00",
    porcentaje: "50.00",
    importeCalculado: "500.00",
    ...over,
  };
}

// Una compra repartida 50/50 entre los destinos 10 y 11, repetida `copias` veces
// (lo que dejaron las corridas concurrentes del motor).
function compraRepartida(compraRowId: string, copias: number): FilaDistribucion[] {
  const filas: FilaDistribucion[] = [];
  for (let c = 0; c < copias; c++) {
    filas.push(fila({ compraRowId, destinoId: 10 }), fila({ compraRowId, destinoId: 11 }));
  }
  return filas;
}

describe("planLimpiezaDistribuciones", () => {
  it("sin duplicados no borra nada", () => {
    const plan = planLimpiezaDistribuciones(compraRepartida("c1", 1));
    expect(plan.idsABorrar).toEqual([]);
    expect(plan.comprasExcluidas).toEqual([]);
    expect(plan.comprasALimpiar).toBe(0);
  });

  it("copia ×3: conserva la de menor id por destino y borra las otras dos", () => {
    const filas = compraRepartida("c1", 3);
    const plan = planLimpiezaDistribuciones(filas);

    const conservadas = filas.slice(0, 2).map((f) => f.id);
    expect(plan.idsABorrar).toHaveLength(4);
    for (const id of conservadas) expect(plan.idsABorrar).not.toContain(id);
    expect(plan.comprasALimpiar).toBe(1);
  });

  it("copia ×2 en varias compras: las limpia todas", () => {
    const plan = planLimpiezaDistribuciones([...compraRepartida("c1", 2), ...compraRepartida("c2", 2)]);
    expect(plan.idsABorrar).toHaveLength(4);
    expect(plan.comprasALimpiar).toBe(2);
  });

  it("devuelve cuánto importe inflado se libera (suma de las copias sobrantes)", () => {
    const plan = planLimpiezaDistribuciones(compraRepartida("c1", 3));
    // 2 copias sobrantes × (500 + 500)
    expect(plan.importeLiberado).toBeCloseTo(2000, 2);
  });

  it("deja intactas las compras sin duplicado aunque convivan con duplicadas", () => {
    const sana = compraRepartida("sana", 1);
    const plan = planLimpiezaDistribuciones([...sana, ...compraRepartida("dup", 2)]);
    for (const f of sana) expect(plan.idsABorrar).not.toContain(f.id);
    expect(plan.comprasALimpiar).toBe(1);
  });

  describe("excluye la compra completa (no borra nada de ella) si la forma no es la esperada", () => {
    it("copias desparejas: un destino ×3 y el otro ×2", () => {
      const filas = [
        fila({ compraRowId: "c1", destinoId: 10 }), fila({ compraRowId: "c1", destinoId: 10 }), fila({ compraRowId: "c1", destinoId: 10 }),
        fila({ compraRowId: "c1", destinoId: 11 }), fila({ compraRowId: "c1", destinoId: 11 }),
      ];
      const plan = planLimpiezaDistribuciones(filas);
      expect(plan.idsABorrar).toEqual([]);
      expect(plan.comprasExcluidas).toEqual([{ compraRowId: "c1", motivo: expect.stringContaining("desparejas") }]);
    });

    it("copias con importes distintos entre sí", () => {
      const filas = [
        fila({ compraRowId: "c1", destinoId: 10 }),
        fila({ compraRowId: "c1", destinoId: 10, importeCalculado: "600.00" }),
        fila({ compraRowId: "c1", destinoId: 11 }),
        fila({ compraRowId: "c1", destinoId: 11 }),
      ];
      const plan = planLimpiezaDistribuciones(filas);
      expect(plan.idsABorrar).toEqual([]);
      expect(plan.comprasExcluidas[0]).toMatchObject({ compraRowId: "c1", motivo: expect.stringContaining("distintos") });
    });

    it("repartida por más de una regla", () => {
      const filas = [
        ...compraRepartida("c1", 2),
        fila({ compraRowId: "c1", destinoId: 20, reglaId: 2 }),
      ];
      const plan = planLimpiezaDistribuciones(filas);
      expect(plan.idsABorrar).toEqual([]);
      expect(plan.comprasExcluidas[0]).toMatchObject({ compraRowId: "c1", motivo: expect.stringContaining("regla") });
    });

    it("lo conservado no suma el importe original (la compra cambió de importe)", () => {
      const filas = [
        fila({ compraRowId: "c1", destinoId: 10, importeCalculado: "400.00" }),
        fila({ compraRowId: "c1", destinoId: 10, importeCalculado: "400.00" }),
        fila({ compraRowId: "c1", destinoId: 11, importeCalculado: "400.00" }),
        fila({ compraRowId: "c1", destinoId: 11, importeCalculado: "400.00" }),
      ];
      const plan = planLimpiezaDistribuciones(filas);
      expect(plan.idsABorrar).toEqual([]);
      expect(plan.comprasExcluidas[0]).toMatchObject({ compraRowId: "c1", motivo: expect.stringContaining("suma") });
    });

    it("una compra excluida no impide limpiar a las demás", () => {
      const rara = [
        fila({ compraRowId: "rara", destinoId: 10 }), fila({ compraRowId: "rara", destinoId: 10 }), fila({ compraRowId: "rara", destinoId: 10 }),
        fila({ compraRowId: "rara", destinoId: 11 }),
      ];
      const plan = planLimpiezaDistribuciones([...rara, ...compraRepartida("ok", 2)]);
      expect(plan.comprasALimpiar).toBe(1);
      expect(plan.idsABorrar).toHaveLength(2);
      expect(plan.comprasExcluidas.map((c) => c.compraRowId)).toEqual(["rara"]);
    });
  });

  it("tolera diferencias de centavos en la suma (redondeo del reparto)", () => {
    // 100.00 repartido en 3 → 33.33 + 33.33 + 33.34
    const filas = [1, 2].flatMap(() => [
      fila({ compraRowId: "c1", destinoId: 10, importeOriginal: "100.00", importeCalculado: "33.33" }),
      fila({ compraRowId: "c1", destinoId: 11, importeOriginal: "100.00", importeCalculado: "33.33" }),
      fila({ compraRowId: "c1", destinoId: 12, importeOriginal: "100.00", importeCalculado: "33.34" }),
    ]);
    const plan = planLimpiezaDistribuciones(filas);
    expect(plan.comprasALimpiar).toBe(1);
    expect(plan.idsABorrar).toHaveLength(3);
  });
});
