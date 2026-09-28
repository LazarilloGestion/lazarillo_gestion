import { construirEntidadIdProveedorTexto } from "../lib/proveedor-entidad-id";

export interface CodigoConteo {
  codigo: string;
  cantidadCompras: number;
  totalDistribuido: number;
}

export interface ReglaCandidata {
  id: number;
  // Formato viejo, sin sufijo de código todavía — ej. "texto:jorge".
  entidadId: string;
  destinos: { localId: number | null; puntoDeVentaId: number | null; porcentaje: number }[];
  vigencia: { modo: string; fechaDesde: Date | null; fechaHasta: Date | null; extremosInclusivos: boolean };
  origen: { origenLocalId: number | null; origenPuntoDeVentaId: number | null };
  // Códigos reales entre las compras que ESTA regla puntual ya distribuyó —
  // no un conteo a nivel de nombre. Una misma persona (nombre) puede tener
  // varias reglas con vigencias distintas (ej. "Lucas" en 3 ventanas de
  // tiempo con reparto distinto) y cada una puede tocar un subconjunto
  // distinto de códigos reales según qué compras cayeron en su ventana.
  codigos: CodigoConteo[];
}

export type DecisionRegla =
  | { tipo: "renombrar"; reglaId: number; entidadIdNuevo: string }
  | { tipo: "dividir"; reglaId: number; codigosNuevos: string[] }
  | { tipo: "omitir"; reglaId: number; razon: string };

const PREFIJO_TEXTO = "texto:";

// Pura — decide qué hacer con UNA regla en base a lo que ella misma ya
// distribuyó. 0 códigos: no hay evidencia de a cuál migrarla (nunca
// distribuyó nada, o todo lo que distribuyó quedó sin código legible) — se
// omite, no se inventa un valor. 1 código: la regla nunca mezcló dos
// personas en la práctica (aunque el nombre en general pueda tener más de
// una), renombrar alcanza. 2+: mezcla real — dividir en una regla nueva por
// código, ver docs/superpowers/specs/2026-09-28-codigo-empleado-proveedor-design.md §4.2.
export function decidirMigracionRegla(regla: ReglaCandidata): DecisionRegla {
  if (regla.codigos.length === 0) {
    return { tipo: "omitir", reglaId: regla.id, razon: "la regla no tiene compras ya distribuidas — no hay evidencia de qué código usar" };
  }
  if (regla.codigos.length === 1) {
    const normalizado = regla.entidadId.slice(PREFIJO_TEXTO.length);
    return {
      tipo: "renombrar",
      reglaId: regla.id,
      entidadIdNuevo: construirEntidadIdProveedorTexto(normalizado, regla.codigos[0].codigo),
    };
  }
  return { tipo: "dividir", reglaId: regla.id, codigosNuevos: regla.codigos.map((c) => c.codigo) };
}

export function planificarMigracionReglas(reglas: ReglaCandidata[]): DecisionRegla[] {
  return reglas.map(decidirMigracionRegla);
}
