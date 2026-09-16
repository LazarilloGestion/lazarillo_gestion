import { describe, expect, it } from "vitest";
import { buildBootstrapScript, type BootstrapFieldConfig } from "./bootstrap-script";

describe("buildBootstrapScript", () => {
  it("genera un IIFE que incluye la config serializada", () => {
    const fields: BootstrapFieldConfig[] = [
      {
        storageKey: "dashboard:state",
        statePath: "state.showFilters",
        target: "documentElement",
        attrs: [{ name: "data-filters-open", map: { false: "false" }, default: "true" }],
      },
    ];
    const script = buildBootstrapScript(fields);
    expect(script).toContain("dashboard:state");
    expect(script).toContain("data-filters-open");
    expect(script.startsWith("(function(){")).toBe(true);
  });

  it("es JS válido (no explota al evaluarlo con un DOM/localStorage simulados)", () => {
    const fields: BootstrapFieldConfig[] = [
      {
        storageKey: "dashboard:state",
        statePath: "state.showFilters",
        target: "documentElement",
        attrs: [{ name: "data-filters-open", map: { false: "false" }, default: "true" }],
      },
    ];
    const script = buildBootstrapScript(fields);

    const attrs: Record<string, string> = {};
    const fakeDocumentElement = {
      setAttribute: (name: string, value: string) => {
        attrs[name] = value;
      },
    };
    const fakeStorage = {
      getItem: () => JSON.stringify({ state: { showFilters: false } }),
    };
    const fn = new Function(
      "localStorage",
      "document",
      `${script}`
    );
    fn(fakeStorage, { documentElement: fakeDocumentElement, querySelector: () => null });

    expect(attrs["data-filters-open"]).toBe("false");
  });

  it("con querySelector como target, aplica los atributos al elemento encontrado", () => {
    const fields: BootstrapFieldConfig[] = [
      {
        storageKey: "dashboard:state",
        statePath: "state.sidebarOpen",
        target: { querySelector: '[data-slot="sidebar"]' },
        attrs: [
          { name: "data-state", map: { false: "collapsed" }, default: "expanded" },
          { name: "data-collapsible", map: { false: "icon" }, default: "" },
        ],
      },
    ];
    const script = buildBootstrapScript(fields);

    const attrs: Record<string, string> = {};
    const fakeEl = { setAttribute: (name: string, value: string) => { attrs[name] = value; } };
    const fakeStorage = { getItem: () => JSON.stringify({ state: { sidebarOpen: false } }) };
    const fn = new Function("localStorage", "document", script);
    fn(fakeStorage, { documentElement: null, querySelector: () => fakeEl });

    expect(attrs["data-state"]).toBe("collapsed");
    expect(attrs["data-collapsible"]).toBe("icon");
  });

  it("si el storage está vacío, aplica el default sin explotar", () => {
    const fields: BootstrapFieldConfig[] = [
      {
        storageKey: "dashboard:state",
        statePath: "state.showFilters",
        target: "documentElement",
        attrs: [{ name: "data-filters-open", map: { false: "false" }, default: "true" }],
      },
    ];
    const script = buildBootstrapScript(fields);
    const attrs: Record<string, string> = {};
    const fakeDocumentElement = { setAttribute: (name: string, value: string) => { attrs[name] = value; } };
    const fakeStorage = { getItem: () => null };
    const fn = new Function("localStorage", "document", script);
    fn(fakeStorage, { documentElement: fakeDocumentElement, querySelector: () => null });
    expect(attrs["data-filters-open"]).toBe("true");
  });

  it("si el JSON está corrupto, aplica el default sin explotar", () => {
    const fields: BootstrapFieldConfig[] = [
      {
        storageKey: "dashboard:state",
        statePath: "state.showFilters",
        target: "documentElement",
        attrs: [{ name: "data-filters-open", map: { false: "false" }, default: "true" }],
      },
    ];
    const script = buildBootstrapScript(fields);
    const attrs: Record<string, string> = {};
    const fakeDocumentElement = { setAttribute: (name: string, value: string) => { attrs[name] = value; } };
    const fakeStorage = { getItem: () => "{not valid json" };
    const fn = new Function("localStorage", "document", script);
    expect(() => fn(fakeStorage, { documentElement: fakeDocumentElement, querySelector: () => null })).not.toThrow();
    expect(attrs["data-filters-open"]).toBe("true");
  });
});
