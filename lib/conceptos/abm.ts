import { z } from "zod";

// Conceptos propios de Lazarillo (Diego, 26/10/2026): códigos desde 1000 —
// MaxiRest llega al 999, así nunca chocan. Los menores a 1000 vienen de MaxiRest
// y por ahora no se modifican desde el Panel.
export const CODIGO_MIN_LAZARILLO = 1000;

export const esPropio = (codigo: number | string) => Number(codigo) >= CODIGO_MIN_LAZARILLO;

export function proximoCodigoLazarillo(codigos: Iterable<number | string>): number {
  let max = CODIGO_MIN_LAZARILLO - 1;
  for (const c of codigos) {
    const n = Number(c);
    if (Number.isInteger(n) && n > max) max = n;
  }
  return max + 1;
}

// Tipos de concepto tal como los guarda MaxiRest.
export const TIPOS_CONCEPTO = [
  { valor: "-", etiqueta: "Egreso" },
  { valor: "+", etiqueta: "Ingreso" },
  { valor: "E", etiqueta: "Empleados" },
] as const;

export const etiquetaTipo = (t: string | null) => TIPOS_CONCEPTO.find((x) => x.valor === t)?.etiqueta ?? "—";

export const conceptoPropioSchema = z.object({
  codigo: z.number().int().min(CODIGO_MIN_LAZARILLO).max(999_999).optional(),
  nombre: z.string().trim().min(1, "Poné un nombre").max(60),
  tipo: z.enum(["-", "+", "E"]),
  codRubro: z.string().trim().min(1, "Elegí un rubro").max(10),
  imputacion: z.string().trim().max(20).optional().transform((v) => (v ? v : null)),
});
export type ConceptoPropioInput = z.infer<typeof conceptoPropioSchema>;
