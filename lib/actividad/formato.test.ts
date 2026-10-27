import { describe, it, expect } from "vitest";
import { etiquetaDia, agruparPorDia, partesDescripcion, horaDe } from "./formato";

const ahora = new Date("2026-10-27T13:00:00Z"); // martes 27/10, 10:00 en Argentina

describe("actividad por día", () => {
  it("hoy y ayer con el día completo; antes, el día de la semana", () => {
    expect(etiquetaDia(new Date("2026-10-27T12:42:00Z"), ahora)).toBe("Hoy · martes 27/10");
    expect(etiquetaDia(new Date("2026-10-27T02:00:00Z"), ahora)).toBe("Ayer · lunes 26/10"); // 23 h del 26 en Argentina
    expect(etiquetaDia(new Date("2026-10-24T14:00:00Z"), ahora)).toBe("Sábado 24/10");
    expect(etiquetaDia(new Date("2025-12-31T14:00:00Z"), ahora)).toBe("Miércoles 31/12/2025");
  });
  it("agrupa seguidos y da la hora local", () => {
    const g = agruparPorDia([{ creadoEn: "2026-10-27T13:42:00Z" }, { creadoEn: "2026-10-27T12:00:00Z" }, { creadoEn: "2026-10-26T21:20:00Z" }], ahora);
    expect(g.map((x) => [x.dia, x.items.length])).toEqual([["Hoy · martes 27/10", 2], ["Ayer · lunes 26/10", 1]]);
    expect(horaDe(new Date("2026-10-27T13:42:00Z"))).toBe("10:42");
  });
  it("nombre y detalle", () => {
    expect(partesDescripcion("Carnes Franco\nTic 2126-26102026 · $ 1")).toEqual({ nombre: "Carnes Franco", detalle: "Tic 2126-26102026 · $ 1" });
    expect(partesDescripcion("viejo")).toEqual({ nombre: null, detalle: "viejo" });
  });
});
