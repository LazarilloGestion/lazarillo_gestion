import { z } from "zod";
import { validarSumaPorcentajes } from "./validaciones";

export const destinoSchema = z
  .object({
    localId: z.number().int().positive().nullable().optional(),
    puntoDeVentaId: z.number().int().positive().nullable().optional(),
    porcentaje: z.number().min(0).max(100),
  })
  .refine((d) => d.localId != null || d.puntoDeVentaId != null, {
    message: "Cada destino requiere localId o puntoDeVentaId",
  });

const camposVigencia = {
  modo: z.enum(["historico", "entre_fechas", "desde_adelante", "desde_atras"]),
  fechaDesde: z.string().datetime({ offset: true }).nullable().optional(),
  fechaHasta: z.string().datetime({ offset: true }).nullable().optional(),
  extremosInclusivos: z.boolean().default(true),
  destinos: z.array(destinoSchema).min(1),
  confirmarHistorico: z.boolean().optional(),
};

// Reglas de negocio comunes a crear y editar — no reinventar por endpoint. Ver
// docs/superpowers/specs/2026-08-19-apertura-gastos-design.md sección 7/10.1.
function validarCuerpoRegla(
  data: {
    modo: string;
    fechaDesde?: string | null;
    fechaHasta?: string | null;
    destinos: { porcentaje: number }[];
    confirmarHistorico?: boolean;
  },
  ctx: z.RefinementCtx
) {
  if (!validarSumaPorcentajes(data.destinos)) {
    const suma = data.destinos.reduce((acc, d) => acc + d.porcentaje, 0);
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `La suma de porcentajes debe ser 100 (actual: ${suma})`,
      path: ["destinos"],
    });
  }
  if (data.modo === "entre_fechas" && (!data.fechaDesde || !data.fechaHasta)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "modo 'entre_fechas' requiere fechaDesde y fechaHasta",
      path: ["fechaDesde"],
    });
  }
  if (data.modo === "desde_adelante" && !data.fechaDesde) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "modo 'desde_adelante' requiere fechaDesde", path: ["fechaDesde"] });
  }
  if (data.modo === "desde_atras" && !data.fechaHasta) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "modo 'desde_atras' requiere fechaHasta", path: ["fechaHasta"] });
  }
  if (data.modo === "historico" && data.confirmarHistorico !== true) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "modo 'historico' requiere confirmarHistorico: true",
      path: ["confirmarHistorico"],
    });
  }
}

export const crearReglaSchema = z
  .object({
    entidadId: z.string().min(1).max(50),
    ...camposVigencia,
  })
  .superRefine(validarCuerpoRegla);

export type CrearReglaInput = z.infer<typeof crearReglaSchema>;

// PATCH tiene dos formas mutuamente excluyentes, discriminadas por "accion":
// desactivar (solo detiene aplicación futura, no toca distribuciones ya
// generadas) o editar (reemplaza destinos/vigencia — el route handler,
// Task 7, revierte y reaplica completo). No hay "reactivar": la spec no
// discute ese caso, no se inventa (YAGNI).
export const patchReglaSchema = z
  .discriminatedUnion("accion", [
    z.object({ accion: z.literal("desactivar") }),
    z.object({ accion: z.literal("editar"), ...camposVigencia }),
  ])
  .superRefine((data, ctx) => {
    if (data.accion === "editar") validarCuerpoRegla(data, ctx);
  });

export type PatchReglaInput = z.infer<typeof patchReglaSchema>;
