import { describe, it, expect } from "vitest";
import { crearReglaSchema, patchReglaSchema, previewTotalQuerySchema } from "./schemas";

const destinosOk = [
  { localId: 1, porcentaje: 60 },
  { localId: 2, porcentaje: 40 },
];

describe("crearReglaSchema", () => {
  it("acepta un cuerpo válido en modo entre_fechas", () => {
    const result = crearReglaSchema.safeParse({
      entidadId: "17",
      modo: "entre_fechas",
      fechaDesde: "2026-01-01T00:00:00Z",
      fechaHasta: "2026-01-31T00:00:00Z",
      extremosInclusivos: true,
      destinos: destinosOk,
    });
    expect(result.success).toBe(true);
  });

  it("rechaza suma de porcentajes != 100 (CA-10)", () => {
    const result = crearReglaSchema.safeParse({
      entidadId: "17",
      modo: "historico",
      confirmarHistorico: true,
      destinos: [{ localId: 1, porcentaje: 60 }, { localId: 2, porcentaje: 30 }],
    });
    expect(result.success).toBe(false);
  });

  it("rechaza modo historico sin confirmarHistorico (CA-06: advertencia obligatoria en histórico completo)", () => {
    const result = crearReglaSchema.safeParse({
      entidadId: "17",
      modo: "historico",
      destinos: destinosOk,
    });
    expect(result.success).toBe(false);
  });

  it("acepta modo historico con confirmarHistorico: true", () => {
    const result = crearReglaSchema.safeParse({
      entidadId: "17",
      modo: "historico",
      confirmarHistorico: true,
      destinos: destinosOk,
    });
    expect(result.success).toBe(true);
  });

  it("rechaza entre_fechas sin fechaHasta", () => {
    const result = crearReglaSchema.safeParse({
      entidadId: "17",
      modo: "entre_fechas",
      fechaDesde: "2026-01-01T00:00:00Z",
      destinos: destinosOk,
    });
    expect(result.success).toBe(false);
  });

  it("rechaza desde_adelante sin fechaDesde", () => {
    const result = crearReglaSchema.safeParse({
      entidadId: "17",
      modo: "desde_adelante",
      destinos: destinosOk,
    });
    expect(result.success).toBe(false);
  });

  it("rechaza un destino sin localId ni puntoDeVentaId", () => {
    const result = crearReglaSchema.safeParse({
      entidadId: "17",
      modo: "historico",
      confirmarHistorico: true,
      destinos: [{ porcentaje: 100 }],
    });
    expect(result.success).toBe(false);
  });

  it("rechaza lista de destinos vacía", () => {
    const result = crearReglaSchema.safeParse({
      entidadId: "17",
      modo: "historico",
      confirmarHistorico: true,
      destinos: [],
    });
    expect(result.success).toBe(false);
  });

  it("rechaza entidadId vacío", () => {
    const result = crearReglaSchema.safeParse({
      entidadId: "",
      modo: "historico",
      confirmarHistorico: true,
      destinos: destinosOk,
    });
    expect(result.success).toBe(false);
  });

  it("rechaza dos destinos con el mismo local y punto de venta", () => {
    const result = crearReglaSchema.safeParse({
      entidadId: "17",
      modo: "historico",
      confirmarHistorico: true,
      destinos: [
        { localId: 1, puntoDeVentaId: 5, porcentaje: 50 },
        { localId: 1, puntoDeVentaId: 5, porcentaje: 50 },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rechaza 'todo el local' superpuesto con un punto de venta específico del mismo local", () => {
    const result = crearReglaSchema.safeParse({
      entidadId: "17",
      modo: "historico",
      confirmarHistorico: true,
      destinos: [
        { localId: 1, puntoDeVentaId: 5, porcentaje: 50 },
        { localId: 1, porcentaje: 50 },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe("patchReglaSchema", () => {
  it("acepta accion: desactivar sin más campos", () => {
    const result = patchReglaSchema.safeParse({ accion: "desactivar" });
    expect(result.success).toBe(true);
  });

  it("acepta accion: editar con cuerpo completo válido", () => {
    const result = patchReglaSchema.safeParse({
      accion: "editar",
      modo: "desde_adelante",
      fechaDesde: "2026-03-01T00:00:00Z",
      destinos: destinosOk,
    });
    expect(result.success).toBe(true);
  });

  it("rechaza accion: editar con suma de porcentajes inválida", () => {
    const result = patchReglaSchema.safeParse({
      accion: "editar",
      modo: "desde_adelante",
      fechaDesde: "2026-03-01T00:00:00Z",
      destinos: [{ localId: 1, porcentaje: 50 }],
    });
    expect(result.success).toBe(false);
  });

  it("rechaza una acción desconocida", () => {
    const result = patchReglaSchema.safeParse({ accion: "reactivar" });
    expect(result.success).toBe(false);
  });

  it("rechaza cuerpo sin accion", () => {
    const result = patchReglaSchema.safeParse({ modo: "historico" });
    expect(result.success).toBe(false);
  });
});

describe("previewTotalQuerySchema", () => {
  it("acepta modo historico con solo entidadId (sin confirmarHistorico — no aplica al preview)", () => {
    const result = previewTotalQuerySchema.safeParse({ entidadId: "17", modo: "historico" });
    expect(result.success).toBe(true);
  });

  it("acepta modo entre_fechas con ambas fechas", () => {
    const result = previewTotalQuerySchema.safeParse({
      entidadId: "17",
      modo: "entre_fechas",
      fechaDesde: "2026-01-01T00:00:00Z",
      fechaHasta: "2026-01-31T00:00:00Z",
    });
    expect(result.success).toBe(true);
  });

  it("rechaza desde_adelante sin fechaDesde", () => {
    const result = previewTotalQuerySchema.safeParse({ entidadId: "17", modo: "desde_adelante" });
    expect(result.success).toBe(false);
  });

  it("rechaza desde_atras sin fechaHasta", () => {
    const result = previewTotalQuerySchema.safeParse({ entidadId: "17", modo: "desde_atras" });
    expect(result.success).toBe(false);
  });

  it("rechaza entidadId vacío", () => {
    const result = previewTotalQuerySchema.safeParse({ entidadId: "", modo: "historico" });
    expect(result.success).toBe(false);
  });
});
