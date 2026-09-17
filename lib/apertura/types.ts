// DTOs del lado cliente para las respuestas de /api/apertura/reglas —
// Prisma.Decimal serializa a string sobre JSON (mismo criterio que
// CompraDetalle en lib/dashboard/types.ts), DateTime serializa a ISO string.

import type { NivelRegla } from "./schemas";

export type ModoVigenciaApi = "historico" | "entre_fechas" | "desde_adelante" | "desde_atras";
export type EstadoReglaApi = "activa" | "inactiva";

export interface DestinoReglaDTO {
  id: number;
  reglaId: number;
  localId: number | null;
  puntoDeVentaId: number | null;
  porcentaje: string;
}

export interface ReglaAperturaDTO {
  id: number;
  nivel: NivelRegla;
  entidadId: string;
  origenLocalId: number | null;
  origenPuntoDeVentaId: number | null;
  modo: ModoVigenciaApi;
  fechaDesde: string | null;
  fechaHasta: string | null;
  extremosInclusivos: boolean;
  estado: EstadoReglaApi;
  creadoPor: string | null;
  creadoEn: string;
  destinos: DestinoReglaDTO[];
}
