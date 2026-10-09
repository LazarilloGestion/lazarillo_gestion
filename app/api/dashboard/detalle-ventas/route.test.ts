import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { DETALLE_VENTAS_LIMITE } from "@/lib/dashboard/constants";

const findMany = vi.fn();
vi.mock("@/lib/prisma", () => ({ prisma: { venta: { findMany: (...args: unknown[]) => findMany(...args) } } }));
vi.mock("@/lib/auth/require-auth", () => ({ requireAuth: async () => null }));

const { GET } = await import("./route");

function ventas(n: number) {
  return Array.from({ length: n }, (_, i) => ({ rowId: `v${i}` }));
}

async function pedir() {
  const res = await GET(new NextRequest("http://localhost/api/dashboard/detalle-ventas?year=2026"));
  return res.json() as Promise<{ data: unknown[]; hasMore?: boolean }>;
}

describe("GET /api/dashboard/detalle-ventas", () => {
  beforeEach(() => findMany.mockReset());

  it("pide una fila más que el tope para detectar el corte sin COUNT aparte", async () => {
    findMany.mockResolvedValue([]);
    await pedir();
    expect(findMany.mock.calls[0][0].take).toBe(DETALLE_VENTAS_LIMITE + 1);
  });

  it("con más ventas que el tope: recorta al tope y avisa con hasMore", async () => {
    findMany.mockResolvedValue(ventas(DETALLE_VENTAS_LIMITE + 1));
    const body = await pedir();
    expect(body.data).toHaveLength(DETALLE_VENTAS_LIMITE);
    expect(body.hasMore).toBe(true);
  });

  it("sin superar el tope: devuelve todo, sin hasMore", async () => {
    findMany.mockResolvedValue(ventas(3));
    const body = await pedir();
    expect(body.data).toHaveLength(3);
    expect(body.hasMore).toBe(false);
  });

  it("ordena con desempate estable, para que el corte no cambie entre pedidos", async () => {
    findMany.mockResolvedValue([]);
    await pedir();
    expect(findMany.mock.calls[0][0].orderBy).toEqual([{ fecha: "asc" }, { rowId: "asc" }]);
  });
});
