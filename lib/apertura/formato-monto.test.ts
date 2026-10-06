import { describe, it, expect } from "vitest";
import { formatearMonto, formatearMontoTipeado, parsearMonto, posicionTrasFormatear } from "./formato-monto";

describe("formatearMonto", () => {
  it("agrupa miles con punto, incluso con 4 dígitos", () => {
    expect(formatearMonto(1234)).toBe("1.234");
    expect(formatearMonto(1708820)).toBe("1.708.820");
    expect(formatearMonto(37443230)).toBe("37.443.230");
  });

  it("no agrega decimales a un entero", () => {
    expect(formatearMonto(100)).toBe("100");
    expect(formatearMonto(0)).toBe("0");
  });

  it("muestra decimales con coma, sin ceros de relleno", () => {
    expect(formatearMonto(1708820.37)).toBe("1.708.820,37");
    expect(formatearMonto(10.5)).toBe("10,5");
  });
});

describe("formatearMontoTipeado", () => {
  it("vacío queda vacío", () => {
    expect(formatearMontoTipeado("")).toBe("");
  });

  it("agrega puntos de miles a medida que se tipea", () => {
    expect(formatearMontoTipeado("1708820")).toBe("1.708.820");
    expect(formatearMontoTipeado("1.7088200")).toBe("17.088.200");
  });

  it("conserva la coma recién tipeada y los decimales a medio escribir", () => {
    expect(formatearMontoTipeado("1.234,")).toBe("1.234,");
    expect(formatearMontoTipeado("1.234,5")).toBe("1.234,5");
  });

  it("coma sin parte entera arranca con 0", () => {
    expect(formatearMontoTipeado(",5")).toBe("0,5");
  });

  it("limita a 2 decimales", () => {
    expect(formatearMontoTipeado("1,2345")).toBe("1,23");
  });

  it("ignora una segunda coma", () => {
    expect(formatearMontoTipeado("1,2,3")).toBe("1,23");
  });

  it("descarta letras, signos y espacios", () => {
    expect(formatearMontoTipeado("$ -1a2b")).toBe("12");
  });

  it("saca ceros a la izquierda pero respeta 0,x", () => {
    expect(formatearMontoTipeado("007")).toBe("7");
    expect(formatearMontoTipeado("0,5")).toBe("0,5");
    expect(formatearMontoTipeado("0")).toBe("0");
  });

  it("trata el punto siempre como separador de miles (pegado en formato inglés)", () => {
    expect(formatearMontoTipeado("1708820.5")).toBe("17.088.205");
  });
});

describe("parsearMonto", () => {
  it("vacío o solo coma no es un número", () => {
    expect(parsearMonto("")).toBeNull();
    expect(parsearMonto(",")).toBeNull();
  });

  it("parsea miles y decimales es-AR", () => {
    expect(parsearMonto("1.708.820")).toBe(1708820);
    expect(parsearMonto("1.234,5")).toBe(1234.5);
    expect(parsearMonto("1.234,")).toBe(1234);
    expect(parsearMonto("0,37")).toBe(0.37);
  });

  it("es el inverso de formatearMonto", () => {
    for (const n of [0, 5, 1234, 1708820.37, 37443230.1]) {
      expect(parsearMonto(formatearMonto(n))).toBe(n);
    }
  });
});

describe("posicionTrasFormatear", () => {
  it("mantiene el cursor tras el mismo dígito cuando aparecen puntos", () => {
    // "1234|" → "1.234|": 4 dígitos antes del cursor, ahora el cursor va al final
    expect(posicionTrasFormatear("1.234", 4)).toBe(5);
    // "12|34" → "1.234": 2 dígitos antes del cursor → después del "2" (índice 3)
    expect(posicionTrasFormatear("1.234", 2)).toBe(3);
  });

  it("cursor al inicio queda al inicio", () => {
    expect(posicionTrasFormatear("1.234", 0)).toBe(0);
  });

  it("cuenta la coma como carácter significativo", () => {
    expect(posicionTrasFormatear("1.234,5", 5)).toBe(6);
  });

  it("cursor más allá del final queda al final", () => {
    expect(posicionTrasFormatear("12", 9)).toBe(2);
  });
});
