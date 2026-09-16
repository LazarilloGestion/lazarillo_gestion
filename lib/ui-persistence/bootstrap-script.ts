// Genera un único script síncrono para inyectar como <script
// dangerouslySetInnerHTML>, que corrige atributos del DOM ANTES del primer
// paint del navegador, leyendo un valor ya persistido en localStorage.
// Reemplaza tener un script bloqueante distinto escrito a mano por cada
// campo "chrome" (hoy solo existía uno, para el tema).
//
// Nota: el tema (dark/light) NO pasa por acá — necesita detectar
// prefers-color-scheme del sistema operativo en la primera visita, algo
// que este generador no contempla (YAGNI: es el único caso con esa regla
// extra). El tema mantiene su propio script en app/layout.tsx.
export type BootstrapAttrConfig = {
  name: string;
  // Mapea String(valorLeído) -> valor de atributo. Si no hay match, se usa `default`.
  map: Record<string, string>;
  default: string;
};

export type BootstrapFieldConfig = {
  storageKey: string;
  // Path dentro del JSON parseado, ej: "state.showFilters" (blob de zustand persist).
  // Si se omite, se usa el valor parseado tal cual.
  statePath?: string;
  target: "documentElement" | { querySelector: string };
  attrs: BootstrapAttrConfig[];
};

export function buildBootstrapScript(fields: BootstrapFieldConfig[]): string {
  const config = JSON.stringify(fields);
  return `(function(){
  var fields = ${config};
  function getPath(obj, path) {
    return path.split(".").reduce(function (acc, key) {
      return acc && typeof acc === "object" ? acc[key] : undefined;
    }, obj);
  }
  for (var i = 0; i < fields.length; i++) {
    try {
      var field = fields[i];
      var raw;
      var stored = localStorage.getItem(field.storageKey);
      if (stored) {
        try {
          var parsed = JSON.parse(stored);
          raw = field.statePath ? getPath(parsed, field.statePath) : parsed;
        } catch (parseError) {}
      }
      var el = field.target === "documentElement" ? document.documentElement : document.querySelector(field.target.querySelector);
      if (!el) continue;
      for (var j = 0; j < field.attrs.length; j++) {
        var attr = field.attrs[j];
        var key = String(raw);
        var value = Object.prototype.hasOwnProperty.call(attr.map, key) ? attr.map[key] : attr.default;
        el.setAttribute(attr.name, value);
      }
    } catch (e) {}
  }
})();`;
}
