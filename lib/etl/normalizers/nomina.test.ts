import { describe, it, expect } from "vitest";
import { detectFileType } from "../detect-file-type";
import { fechaNomina, filaNomina } from "./nomina";

const HEADERS = ["pdv", "codigo", "nombre", "apellido", "direccion", "telefono", "nro_doc", "nombreusu", "nivel", "e_mail", "fecha_ing", "fecha_baja", "sector"];

describe("nómina (000 - nomina del kit)", () => {
  it("se detecta por sus columnas (en minúscula)", () => {
    expect(detectFileType(HEADERS)).toBe("nomina");
  });
  it("lee código, nombre, apellido y baja", () => {
    expect(filaNomina({ pdv: "BAR", codigo: 326, nombre: "Lautaro Ruben ", apellido: "Zuccala", fecha_baja: "" }))
      .toEqual({ codigo: "326", nombre: "Lautaro Ruben", apellido: "Zuccala", fechaBaja: null });
    expect(filaNomina({ codigo: "", nombre: "x" })).toBeNull();
  });
  it("fechas del kit, seriales de Excel y fechas rotas", () => {
    expect(fechaNomina("2025-10-31 0:00:00")).toBe("2025-10-31");
    expect(fechaNomina(45961)).toBe("2025-10-31");
    expect(fechaNomina("0025-07-28")).toBeNull();
    expect(fechaNomina(null)).toBeNull();
  });
});
