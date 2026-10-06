import { describe, it, expect } from "vitest";
import type { Prisma } from "@prisma/client";
import { aplicarRegla, tomarLockDeAplicacion, type AperturaDbClient } from "./motor";
import { reevaluarCompra } from "./reevaluacion";

// Cliente falso que registra el ORDEN de las llamadas al motor. Lo que se
// verifica acá no es el SQL de la distribución sino que el lock de aplicación
// se tome ANTES de la primera lectura: sin eso, dos corridas concurrentes ven
// las mismas compras con esDistribuido = false e insertan cada una su copia
// (duplicados ×2/×3 en Ramos Mejía, 28-sep y 3-oct-2026).
function clienteQueRegistra() {
  const eventos: string[] = [];
  const client = {
    $executeRaw: async (q: Prisma.Sql) => {
      eventos.push(q.sql.includes("pg_advisory_xact_lock") ? "lock" : "escritura");
      return 0;
    },
    $queryRaw: async () => {
      eventos.push("lectura");
      return [];
    },
    compra: {
      findUnique: async () => {
        eventos.push("lectura");
        return null;
      },
    },
  } as unknown as AperturaDbClient;
  return { client, eventos };
}

const inputRegla = {
  reglaId: 1,
  nivel: "concepto" as const,
  entidadId: "GASTO1",
  vigencia: { modo: "historico" as const, fechaDesde: null, fechaHasta: null, extremosInclusivos: true },
  destinos: [{ id: 10, porcentaje: 100 }],
  origen: { origenLocalId: 1, origenPuntoDeVentaId: null },
};

describe("tomarLockDeAplicacion", () => {
  it("toma un advisory lock de transacción (se suelta solo al commit/rollback)", async () => {
    const { client, eventos } = clienteQueRegistra();
    await tomarLockDeAplicacion(client);
    expect(eventos).toEqual(["lock"]);
  });
});

describe("serialización de corridas del motor", () => {
  it("aplicarRegla toma el lock antes de leer las compras elegibles", async () => {
    const { client, eventos } = clienteQueRegistra();
    await aplicarRegla(client, inputRegla);
    expect(eventos[0]).toBe("lock");
    expect(eventos).toContain("lectura");
  });

  it("reevaluarCompra toma el lock antes de leer la compra y revertir su distribución", async () => {
    const { client, eventos } = clienteQueRegistra();
    await reevaluarCompra(client, "row1");
    expect(eventos[0]).toBe("lock");
  });
});
