// Este store depende de `window`/`localStorage` en tiempo de evaluación del
// módulo (rehidratación a nivel de módulo, ver Finding 1 del review de rama).
// El entorno de vitest de este repo es "node" (sin jsdom) — para probar ese
// comportamiento hace falta simular un `window` mínimo ANTES de importar el
// módulo, y forzar una re-evaluación fresca con vi.resetModules() + import()
// dinámico en cada test (si no, zustand cachea el módulo ya evaluado sin
// window y todos los tests comparten la misma instancia de store).
import { afterEach, describe, expect, it, vi } from "vitest";

type FakeLocalStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function createFakeLocalStorage(initial?: Record<string, string>): FakeLocalStorage {
  const map = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    getItem: (key) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

const PERSISTED_BLOB = {
  state: {
    stored: [3, 4],
    sortCol: 2,
    sortDir: "asc",
    year: 2024,
    tab: "ventas",
    localId: 7,
    pdvId: 12,
    agrupacionCompras: "rubro",
    showFilters: false,
    sidebarOpen: false,
  },
};

function installFakeWindow(initial?: Record<string, string>) {
  const fakeLocalStorage = createFakeLocalStorage(initial);
  // No hay `window` global en el entorno "node" de vitest — se define uno
  // mínimo, suficiente para lo que el store lee (`window.localStorage`).
  (globalThis as { window?: unknown }).window = { localStorage: fakeLocalStorage };
  return fakeLocalStorage;
}

afterEach(() => {
  // Limpieza obligatoria: si esto queda pisado, contamina cualquier otro
  // archivo de test que corra "node" y no espere un `window` global.
  delete (globalThis as { window?: unknown }).window;
  vi.resetModules();
});

describe("rehidratación a nivel de módulo (Finding 1 — regresión sidebar/importar)", () => {
  it("rehidrata automáticamente al importar el módulo, sin llamar .rehydrate() ni esperar un efecto", async () => {
    installFakeWindow({ "dashboard:state": JSON.stringify(PERSISTED_BLOB) });
    vi.resetModules();

    const { useDashboardStore } = await import("./use-dashboard-store");
    const state = useDashboardStore.getState();

    expect(state.stored).toEqual([3, 4]);
    expect(state.sortCol).toBe(2);
    expect(state.sortDir).toBe("asc");
    expect(state.year).toBe(2024);
    expect(state.tab).toBe("ventas");
    expect(state.localId).toBe(7);
    expect(state.pdvId).toBe(12);
    expect(state.agrupacionCompras).toBe("rubro");
    expect(state.showFilters).toBe(false);
    expect(state.sidebarOpen).toBe(false);
  });

  it("togglear un campo 'chrome' (sidebarOpen) no pisa el resto del estado ya rehidratado", async () => {
    installFakeWindow({ "dashboard:state": JSON.stringify(PERSISTED_BLOB) });
    vi.resetModules();

    const { useDashboardStore } = await import("./use-dashboard-store");

    // Este es exactamente el gesto que causaba el bug real: togglear el
    // sidebar (disponible en /importar) antes de que nada más "toque" el
    // store. Si la rehidratación no corrió ya, este set() persiste los
    // defaults hardcodeados por encima de lo que estaba guardado.
    useDashboardStore.getState().setSidebarOpen(true);

    const state = useDashboardStore.getState();
    expect(state.sidebarOpen).toBe(true);
    expect(state.year).toBe(2024);
    expect(state.tab).toBe("ventas");
    expect(state.localId).toBe(7);
    expect(state.pdvId).toBe(12);
    expect(state.agrupacionCompras).toBe("rubro");
    expect(state.stored).toEqual([3, 4]);
    expect(state.sortCol).toBe(2);
  });
});

describe("PERSISTED_FIELD_KEYS -> partialize (Finding 3 — wiring exigido por la spec)", () => {
  it("partialize devuelve exactamente las keys de PERSISTED_FIELD_KEYS, ni más ni menos", async () => {
    // No hace falta un blob previo acá: solo se ejercita partialize() contra
    // el estado completo del store, no la rehidratación.
    installFakeWindow();
    vi.resetModules();

    const { useDashboardStore, PERSISTED_FIELD_KEYS } = await import("./use-dashboard-store");

    const fullState = useDashboardStore.getState();
    const { partialize } = useDashboardStore.persist.getOptions();
    expect(partialize).toBeDefined();

    const partialized = partialize!(fullState);

    expect(Object.keys(partialized).sort()).toEqual([...PERSISTED_FIELD_KEYS].sort());
  });
});
