// Clave "texto:<normalizado>" (proveedor sin proveedorId real) con sufijo
// opcional "|codigo:<codigo>" que desambigua personas reales distintas que
// comparten nombre (ej. dos "Abril" con código 368 y 670 — ver
// docs/superpowers/specs/2026-09-28-codigo-empleado-proveedor-design.md
// §3.4/§3.6). Construida en 3 lugares (lib/dashboard/pivot-por-proveedor.ts,
// lib/dashboard/apertura-composicion.ts, lib/apertura/reevaluacion.ts) y
// parseada en un 4to (lib/apertura/motor.ts) — extraída acá para que las 4
// nunca puedan divergir en el formato (hallazgo de la revisión final de rama:
// estaban duplicadas sin test que probara que coincidían).
const PREFIJO_TEXTO = "texto:";
const SEPARADOR_CODIGO = "|codigo:";

// "sinproveedor" es el balde genuino sin proveedorId NI texto crudo del ERP —
// no es una identidad real a desambiguar. Fragmentarlo por código solo
// generaría ruido (una fila por código en vez de un balde consolidado), así
// que nunca lleva el sufijo aunque la compra traiga código (spec §2.7).
const SIN_PROVEEDOR_NORMALIZADO = "sinproveedor";

export function construirEntidadIdProveedorTexto(normalizado: string, codigo: string | null): string {
  const base = `${PREFIJO_TEXTO}${normalizado}`;
  if (codigo == null || normalizado === SIN_PROVEEDOR_NORMALIZADO) return base;
  return `${base}${SEPARADOR_CODIGO}${codigo}`;
}

// Inversa de construirEntidadIdProveedorTexto — separa el nombre normalizado
// del código. Devuelve null si entidadId no tiene el prefijo "texto:" (es un
// proveedorId real o un entidadId de otro nivel, no de esta función).
export function parsearEntidadIdProveedorTexto(entidadId: string): { normalizado: string; codigo: string | null } | null {
  if (!entidadId.startsWith(PREFIJO_TEXTO)) return null;
  const resto = entidadId.slice(PREFIJO_TEXTO.length);
  const separador = resto.indexOf(SEPARADOR_CODIGO);
  if (separador === -1) return { normalizado: resto, codigo: null };
  return { normalizado: resto.slice(0, separador), codigo: resto.slice(separador + SEPARADOR_CODIGO.length) };
}

// Durante la ventana entre este deploy y la migración de las reglas de
// Apertura ya existentes en producción (spec §4, plan aparte todavía no
// escrito), las reglas viejas siguen guardadas con el entidadId SIN código
// para casi todos los proveedores de texto crudo. Si la compra resuelve a un
// entidadId CON código, hay que poder seguir encontrando esa regla vieja —
// se prueban ambas variantes, con la específica por código primero (gana si
// compite con una vieja, ver reevaluarCompra). Para un entidadId que no es
// "texto:..." (proveedorId real) o que ya no tiene sufijo, devuelve solo el
// valor tal cual — sin variantes de más.
export function candidatosEntidadIdProveedor(entidadId: string): string[] {
  const parsed = parsearEntidadIdProveedorTexto(entidadId);
  if (parsed === null || parsed.codigo === null) return [entidadId];
  return [entidadId, construirEntidadIdProveedorTexto(parsed.normalizado, null)];
}
