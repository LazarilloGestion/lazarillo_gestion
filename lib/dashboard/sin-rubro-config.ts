import {
  SIN_RUBRO_CODE,
  SIN_RUBRO_NOMBRE,
  SIN_RUBRO_VISIBILIDAD_DEFAULT,
  type VisibilidadField,
} from "./constants";
import type { RubroVisibilidad } from "./types";

export type SinRubroConfigRow = Record<VisibilidadField, boolean>;

export function resolverVisibilidadSinRubro(row: SinRubroConfigRow | null, field: VisibilidadField): boolean {
  return row ? row[field] : SIN_RUBRO_VISIBILIDAD_DEFAULT[field];
}

// Va al final para no reordenar los rubros reales (que vienen ordenados por nombre).
export function agregarSinRubro(rubros: RubroVisibilidad[], visible: boolean): RubroVisibilidad[] {
  return [...rubros, { codigo: SIN_RUBRO_CODE, nombre: SIN_RUBRO_NOMBRE, visible }];
}
