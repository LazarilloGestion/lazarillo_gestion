import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { insertChunkWithRowFallback } from "./chunked-upsert";
import type { DbClient } from "./types";

function fakeDb(executeRaw: ReturnType<typeof vi.fn>): DbClient {
  return { $executeRaw: executeRaw } as unknown as DbClient;
}

describe("insertChunkWithRowFallback", () => {
  it("el lote se inserta OK de una: no reintenta fila por fila, onRowsInserted recibe el chunk completo", async () => {
    const executeRaw = vi.fn().mockResolvedValue(1);
    const db = fakeDb(executeRaw);
    const inserted: number[] = [];
    const errors = await insertChunkWithRowFallback(
      db,
      [1, 2, 3],
      (rows) => Prisma.sql`INSERT ${Prisma.join(rows.map((r) => Prisma.sql`${r}`))}`,
      () => { throw new Error("no debería llamarse"); },
      (rows) => inserted.push(...(rows as number[]))
    );
    expect(errors).toHaveLength(0);
    expect(inserted).toEqual([1, 2, 3]);
    expect(executeRaw).toHaveBeenCalledTimes(1);
  });

  it("el lote falla completo pero cada fila individual es válida: reintenta fila por fila y todas terminan insertadas", async () => {
    let call = 0;
    const executeRaw = vi.fn().mockImplementation(async () => {
      call++;
      if (call === 1) throw new Error("batch falló");
      return 1;
    });
    const db = fakeDb(executeRaw);
    const inserted: number[] = [];
    const errors = await insertChunkWithRowFallback(
      db,
      [1, 2],
      (rows) => Prisma.sql`INSERT ${Prisma.join(rows.map((r) => Prisma.sql`${r}`))}`,
      () => { throw new Error("no debería llamarse"); },
      (rows) => inserted.push(...(rows as number[]))
    );
    expect(errors).toHaveLength(0);
    expect(inserted.sort()).toEqual([1, 2]);
    expect(executeRaw).toHaveBeenCalledTimes(3); // 1 intento de lote + 2 reintentos individuales
  });

  it("el lote falla completo y una fila individual también falla: esa fila (y solo esa) termina en errors, las demás se insertan", async () => {
    const executeRaw = vi.fn().mockImplementation(async (sql: { values: unknown[] }) => {
      if (sql.values.length > 1) throw new Error("batch falló");
      if (sql.values[0] === "BAD") throw new Error("fila inválida");
      return 1;
    });
    const db = fakeDb(executeRaw);
    const inserted: string[] = [];
    const errors = await insertChunkWithRowFallback(
      db,
      ["OK1", "BAD", "OK2"],
      (rows) => Prisma.sql`INSERT ${Prisma.join(rows.map((r) => Prisma.sql`${r}`))}`,
      (row, err) => ({ rowIndex: 0, rawCodigo: row, message: err instanceof Error ? err.message : String(err) }),
      (rows) => inserted.push(...(rows as string[]))
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].rawCodigo).toBe("BAD");
    expect(inserted.sort()).toEqual(["OK1", "OK2"]);
  });
});
