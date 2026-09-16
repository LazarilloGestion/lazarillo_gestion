import { describe, expect, it } from "vitest";
import { readPersistedField } from "./persisted-sync-read";

function fakeStorage(value: string | null): Pick<Storage, "getItem"> {
  return { getItem: () => value };
}

describe("readPersistedField", () => {
  it("devuelve el valor persistido si existe", () => {
    const storage = fakeStorage(JSON.stringify({ state: { sidebarOpen: false } }));
    expect(readPersistedField("dashboard:state", "sidebarOpen", true, storage)).toBe(false);
  });

  it("devuelve el default si el campo no está en el blob", () => {
    const storage = fakeStorage(JSON.stringify({ state: { otroCampo: 1 } }));
    expect(readPersistedField("dashboard:state", "sidebarOpen", true, storage)).toBe(true);
  });

  it("devuelve el default si no hay nada guardado", () => {
    const storage = fakeStorage(null);
    expect(readPersistedField("dashboard:state", "sidebarOpen", true, storage)).toBe(true);
  });

  it("devuelve el default si el JSON está corrupto, sin explotar", () => {
    const storage = fakeStorage("{not valid json");
    expect(readPersistedField("dashboard:state", "sidebarOpen", true, storage)).toBe(true);
  });

  it("sin storage (undefined) devuelve el default", () => {
    expect(readPersistedField("dashboard:state", "sidebarOpen", true, undefined)).toBe(true);
  });
});
