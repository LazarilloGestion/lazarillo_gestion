import { describe, it, expect } from "vitest";
import { filtrarTabla } from "./use-table-search";

type Fila = { prov: string; obs: string | null; imp: number };
const datos: Fila[] = [
  { prov: "Etiquetas", obs: "Papelera", imp: 200000 },
  { prov: "Graciela Contadora", obs: "Contador Graciela", imp: 200000 },
  { prov: "Adelanto Sueldo", obs: null, imp: 50000 },
];
const fields = (f: Fila) => [f.prov, f.obs];
const cols = (f: Fila) => ({ proveedor: f.prov, observacion: f.obs, importe: String(f.imp) });

describe("filtrarTabla (buscador general + filtro por columna)", () => {
  it("sin filtros devuelve todo", () => {
    expect(filtrarTabla(datos, "", fields, {}, cols)).toHaveLength(3);
  });
  it("buscador general: contiene, sin acentos ni mayúsculas", () => {
    expect(filtrarTabla(datos, "GRACIÉLA", fields, {}, cols)).toHaveLength(1);
  });
  it("filtro por columna: solo esa columna; varios se combinan con AND y con el general", () => {
    expect(filtrarTabla(datos, "", fields, { proveedor: "graciela" }, cols)).toHaveLength(1);
    expect(filtrarTabla(datos, "", fields, { observacion: "graciela" }, cols)).toHaveLength(1);
    expect(filtrarTabla(datos, "", fields, { importe: "200000" }, cols)).toHaveLength(2);
    expect(filtrarTabla(datos, "", fields, { importe: "200000", proveedor: "etiq" }, cols)).toHaveLength(1);
    expect(filtrarTabla(datos, "papel", fields, { importe: "200000" }, cols)).toHaveLength(1);
    expect(filtrarTabla(datos, "papel", fields, { proveedor: "graciela" }, cols)).toHaveLength(0);
  });
  it("filtro vacío o solo espacios no filtra; sin columnFields el filtro por columna no matchea nada", () => {
    expect(filtrarTabla(datos, "", fields, { proveedor: "   " }, cols)).toHaveLength(3);
    expect(filtrarTabla(datos, "", fields, { proveedor: "x" })).toHaveLength(0);
  });
});
