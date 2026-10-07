import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { compararPrioridadNivel, condicionMatchNivel, condicionComprasElegibles, reaplicarReglasActivas } from "./motor";

describe("compararPrioridadNivel", () => {
  it("registro va antes que proveedor", () => {
    expect(compararPrioridadNivel({ nivel: "registro" }, { nivel: "proveedor" })).toBeLessThan(0);
  });
  it("proveedor va antes que concepto", () => {
    expect(compararPrioridadNivel({ nivel: "proveedor" }, { nivel: "concepto" })).toBeLessThan(0);
  });
  it("registro va antes que concepto", () => {
    expect(compararPrioridadNivel({ nivel: "registro" }, { nivel: "concepto" })).toBeLessThan(0);
  });
  it("mismo nivel es equivalente", () => {
    expect(compararPrioridadNivel({ nivel: "concepto" }, { nivel: "concepto" })).toBe(0);
  });
});

describe("condicionMatchNivel", () => {
  it("nivel proveedor con entidadId numérico: compara contra proveedorId, como hoy", () => {
    const cond = condicionMatchNivel("proveedor", "123");
    expect(cond.sql).toContain('"proveedorId"::text = ?');
    expect(cond.values).toEqual(["123"]);
  });

  it("nivel proveedor con entidadId 'texto:<normalizado>': compara contra proveedorTextoNormalizado con proveedorId IS NULL", () => {
    const cond = condicionMatchNivel("proveedor", "texto:diego");
    expect(cond.sql).toContain('"proveedorId" IS NULL');
    expect(cond.sql).toContain('"proveedorTextoNormalizado" = ?');
    expect(cond.values).toEqual(["diego"]);
  });

  it("nivel proveedor con entidadId 'texto:sinproveedor' (nodo genuino Sin Proveedor)", () => {
    const cond = condicionMatchNivel("proveedor", "texto:sinproveedor");
    expect(cond.values).toEqual(["sinproveedor"]);
  });

  it("nivel concepto no se ve afectado por el prefijo 'texto:'", () => {
    const cond = condicionMatchNivel("concepto", "GASTO1");
    expect(cond.sql).toContain('"conceptoCodigoManual"');
    expect(cond.values).toEqual(["GASTO1"]);
  });

  it("nivel proveedor con entidadId 'texto:<normalizado>|codigo:<codigo>': agrega AND sobre c.codigo", () => {
    const cond = condicionMatchNivel("proveedor", "texto:abril|codigo:368");
    expect(cond.sql).toContain('"proveedorId" IS NULL');
    expect(cond.sql).toContain('"proveedorTextoNormalizado" = ?');
    expect(cond.sql).toContain('"codigo" = ?');
    expect(cond.values).toEqual(["abril", "368"]);
  });

  it("nivel proveedor con entidadId 'texto:<normalizado>' sin codigo: comportamiento sin cambios", () => {
    const cond = condicionMatchNivel("proveedor", "texto:diego");
    expect(cond.sql).not.toContain('"codigo" = ?');
    expect(cond.values).toEqual(["diego"]);
  });
});

describe("condicionComprasElegibles — soloRowIds", () => {
  const origen = { origenLocalId: 1, origenPuntoDeVentaId: null };
  const vigencia = Prisma.sql`true`;

  it("sin soloRowIds no agrega ningún filtro por rowId (comportamiento de siempre)", () => {
    const cond = condicionComprasElegibles("concepto", "GASTO1", vigencia, origen);
    expect(cond.sql).not.toContain('c."rowId" = ANY');
  });

  it("con soloRowIds acota la query a esas compras, con un único parámetro array", () => {
    const cond = condicionComprasElegibles("concepto", "GASTO1", vigencia, origen, null, ["a", "b"]);
    expect(cond.sql).toContain('c."rowId" = ANY(?::text[])');
    expect(cond.values).toContainEqual(["a", "b"]);
  });
});

// Cliente falso mínimo: no hay base de test, y lo que se verifica acá es QUÉ
// reglas se reaplican y con qué acotación — no el SQL (cubierto arriba).
function prismaFalso(reglas: unknown[], compras: unknown[]) {
  const consultasEnTx: Prisma.Sql[] = [];
  const tx = {
    $queryRaw: async (q: Prisma.Sql) => { consultasEnTx.push(q); return []; },
    $executeRaw: async () => 0,
  };
  let transacciones = 0;
  const prisma = {
    reglaApertura: { findMany: async () => reglas },
    $queryRaw: async () => compras,
    $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => { transacciones++; return fn(tx); },
  } as unknown as PrismaClient;
  return { prisma, consultasEnTx, transacciones: () => transacciones };
}

function reglaActiva(id: number, nivel: string, entidadId: string) {
  return {
    id, nivel, entidadId, estado: "activa", modo: "historico", fechaDesde: null, fechaHasta: null,
    extremosInclusivos: true, origenLocalId: 1, origenPuntoDeVentaId: null,
    destinos: [{ id: id * 10, porcentaje: 100 }],
  };
}

describe("reaplicarReglasActivas — acotada a compras liberadas", () => {
  const compraConcepto = { rowId: "c1", conceptoEfectivo: "GASTO2", proveedorId: null, proveedorTextoNormalizado: null, codigo: null };
  const reglas = [reglaActiva(1, "concepto", "GASTO1"), reglaActiva(2, "concepto", "GASTO2"), reglaActiva(3, "proveedor", "999")];

  it("sin rowIds (reimportación) reaplica solo las reglas que pueden reclamar compras sin distribuir", async () => {
    // 200 reglas activas en 60 s de maxDuration: reaplicar todas dejaba sin
    // procesar las del final (compras nuevas de Bar sin abrir, 3-oct-2026).
    const { prisma, transacciones } = prismaFalso(reglas, [compraConcepto]);
    const r = await reaplicarReglasActivas(prisma);
    expect(transacciones()).toBe(1);
    expect(r.reglasReaplicadas).toBe(1);
  });

  it("sin rowIds y sin compras sin distribuir no abre ninguna transacción", async () => {
    const { prisma, transacciones } = prismaFalso(reglas, []);
    const r = await reaplicarReglasActivas(prisma);
    expect(transacciones()).toBe(0);
    expect(r).toEqual({ reglasReaplicadas: 0, errores: [] });
  });

  it("sin rowIds mantiene el orden de prioridad entre las reglas seleccionadas", async () => {
    const compraMixta = { rowId: "c1", conceptoEfectivo: "GASTO2", proveedorId: 999, proveedorTextoNormalizado: null, codigo: null };
    const { prisma, consultasEnTx } = prismaFalso(reglas, [compraMixta]);
    await reaplicarReglasActivas(prisma);
    // proveedor (#3) corre antes que concepto (#2): si no, concepto se la queda
    expect(consultasEnTx.map((q) => q.values.some((v) => v === "999") ? "proveedor" : "concepto")).toEqual(["proveedor", "concepto"]);
  });

  it("sin rowIds una regla de registro entra si su compra está sin distribuir", async () => {
    const compraRegistro = { rowId: "reg1", conceptoEfectivo: null, proveedorId: null, proveedorTextoNormalizado: null, codigo: null };
    const { prisma, transacciones } = prismaFalso([reglaActiva(7, "registro", "reg1"), reglaActiva(8, "registro", "otra")], [compraRegistro]);
    await reaplicarReglasActivas(prisma);
    expect(transacciones()).toBe(1);
  });

  it("con rowIds reaplica solo las reglas que pueden reclamar esas compras", async () => {
    const { prisma, transacciones } = prismaFalso(reglas, [compraConcepto]);
    const r = await reaplicarReglasActivas(prisma, { rowIds: ["c1"] });
    expect(transacciones()).toBe(1);
    expect(r.reglasReaplicadas).toBe(1);
  });

  it("con rowIds acota la búsqueda de elegibles a esas compras", async () => {
    const { prisma, consultasEnTx } = prismaFalso(reglas, [compraConcepto]);
    await reaplicarReglasActivas(prisma, { rowIds: ["c1"] });
    expect(consultasEnTx).toHaveLength(1);
    expect(consultasEnTx[0].sql).toContain('c."rowId" = ANY(?::text[])');
    expect(consultasEnTx[0].values).toContainEqual(["c1"]);
  });

  it("con rowIds vacío no reaplica nada (no se liberó ninguna compra)", async () => {
    const { prisma, transacciones } = prismaFalso(reglas, []);
    const r = await reaplicarReglasActivas(prisma, { rowIds: [] });
    expect(transacciones()).toBe(0);
    expect(r).toEqual({ reglasReaplicadas: 0, errores: [] });
  });
});
