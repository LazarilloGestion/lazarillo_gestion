import { describe, it, expect, vi } from "vitest";
vi.mock("@prisma/client", () => ({ Prisma: { sql: () => ({}) } }));
import { diagnosticoImporte, sugerirAnular, type FilaComprobante } from "./corregir";

const f = (x: Partial<FilaComprobante>): FilaComprobante => ({ rowId: "r", comprobante: "A1", localId: 1, fecha: "2025-09-09", concepto: null, cod: "3", importe: 0, origen: null, renNeto: 0, renIva: 0, renN: 0, pagos: 0, anulada: false, ...x });

describe("corregir con ARCA", () => {
  it("Horeca: renglones bien, Caja corta, falta una percepción", () => {
    const d = diagnosticoImporte({ neto: 836525.57, iva: 175670.37, noGravado: 0, exento: 0, otros: 92017.82, total: 1104213.76 }, [
      f({ rowId: "lac", concepto: "Lacteos", importe: 584226.2, renNeto: 836330, renIva: 175629, renN: 8 }),
      f({ rowId: "p1", cod: "133", importe: 25095.77 }),
      f({ rowId: "p2", cod: "899", importe: 41826.28 }),
    ]);
    expect(d.partes[0].ok).toBe(false);
    expect(d.texto).toContain("Los renglones coinciden con ARCA");
    expect(d.texto).toContain("Falta percepción");
    expect(d.igualar).toEqual({ rowId: "lac", importe: 1012195.94 });
  });
  it("duplicado KeegoChat: sugiere anular la que no tiene renglones ni pago", () => {
    const g = [
      { comprobante: "A000200000224", filas: [f({ rowId: "a", comprobante: "A000200000224", fecha: "2025-08-01", renN: 1, pagos: 1, importe: 505359 })] },
      { comprobante: "FCA000200000224", filas: [f({ rowId: "b", comprobante: "FCA000200000224", fecha: "2025-08-01", importe: 505359 })] },
    ];
    expect(sugerirAnular(g, "2025-08-01")).toBe("FCA000200000224");
  });
  it("si no hay cómo distinguirlas, no sugiere", () => {
    const g = [{ comprobante: "A", filas: [f({})] }, { comprobante: "B", filas: [f({})] }];
    expect(sugerirAnular(g, "2025-09-09")).toBeNull();
  });
});
