import { describe, it, expect } from "vitest";
import { parseImportResponse } from "./parse-import-response";
import type { DriveFile } from "@/lib/drive/types";
import type { ETLReport } from "@/lib/etl/types";

function file(id: string): DriveFile {
  return { id, name: `${id}.xlsx`, modifiedTime: "2026-09-26T00:00:00Z", size: "100" };
}

function okReport(overrides: Partial<ETLReport> = {}): ETLReport {
  return {
    fileType: "proveedores",
    totalRows: 10,
    created: 5,
    updated: 5,
    skipped: 0,
    errors: [],
    durationMs: 100,
    ...overrides,
  };
}

describe("parseImportResponse", () => {
  it("todos los archivos ok -> status success y suma de procesadas en recordCount", () => {
    const files = [file("a"), file("b")];
    const json = {
      results: [
        { fileId: "a", fileName: "a.xlsx", report: okReport({ created: 3, updated: 2 }) },
        { fileId: "b", fileName: "b.xlsx", report: okReport({ created: 1, updated: 0 }) },
      ],
    };

    const result = parseImportResponse(files, true, json);

    expect(result.statuses).toEqual({ a: "success", b: "success" });
    expect(result.errorCount).toBe(0);
    expect(result.unsupportedCount).toBe(0);
    expect(result.recordCount).toBe(6);
  });

  it("archivo no soportado -> status unsupported, no suma a errorCount", () => {
    const files = [file("a")];
    const json = {
      results: [
        { fileId: "a", fileName: "a.xlsx", unsupported: true, errorMessage: "No se pudo identificar el tipo de archivo. Columnas encontradas: FOO, BAR" },
      ],
    };

    const result = parseImportResponse(files, true, json);

    expect(result.statuses).toEqual({ a: "unsupported" });
    expect(result.errors.a).toContain("No se pudo identificar");
    expect(result.errorCount).toBe(0);
    expect(result.unsupportedCount).toBe(1);
    expect(result.recordCount).toBe(0);
  });

  it("no soportado en medio del batch no bloquea los archivos que vienen después", () => {
    const files = [file("a"), file("b"), file("c")];
    const json = {
      results: [
        { fileId: "a", fileName: "a.xlsx", report: okReport() },
        { fileId: "b", fileName: "b.xlsx", unsupported: true, errorMessage: "columnas encontradas: X" },
        { fileId: "c", fileName: "c.xlsx", report: okReport() },
      ],
    };

    const result = parseImportResponse(files, true, json);

    expect(result.statuses).toEqual({ a: "success", b: "unsupported", c: "success" });
    expect(result.errorCount).toBe(0);
    expect(result.unsupportedCount).toBe(1);
  });

  it("archivo con todas las filas en error -> status error (no procesó nada)", () => {
    const files = [file("a")];
    const json = {
      results: [
        {
          fileId: "a",
          fileName: "a.xlsx",
          report: okReport({ created: 0, updated: 0, errors: [{ rowIndex: 0, rawCodigo: "X", message: "boom" }] }),
        },
      ],
    };

    const result = parseImportResponse(files, true, json);

    expect(result.statuses.a).toBe("error");
    expect(result.errorCount).toBe(1);
    expect(result.errors.a).toContain("con error");
  });

  it("respuesta no-ok con failedFileId -> ese archivo y los que quedan atrás se marcan error", () => {
    const files = [file("a"), file("b"), file("c")];
    const json = {
      error: "Error procesando el archivo: boom",
      results: [{ fileId: "a", fileName: "a.xlsx", report: okReport() }],
      failedFileId: "b",
    };

    const result = parseImportResponse(files, false, json);

    expect(result.statuses.a).toBe("success");
    expect(result.statuses.b).toBe("error");
    expect(result.errors.b).toBe("Error procesando el archivo: boom");
    expect(result.statuses.c).toBe("error");
    expect(result.errors.c).toContain("otro archivo del mismo lote falló antes");
    expect(result.errorCount).toBe(2);
  });
});
