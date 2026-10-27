import { z } from "zod";

// Gestor de medios de pago (Diego, 27/10/2026): una sola lista para todo el Panel
// (Impagas, cuenta corriente, carga de factura y Gastos Varios), con alta, baja y
// modificación. Los pagos guardan el NOMBRE del medio; renombrar actualiza los pagos.
export const TIPOS_MEDIO = [
  { valor: "caja", etiqueta: "Caja" },
  { valor: "banco", etiqueta: "Banco" },
  { valor: "tarjeta", etiqueta: "Tarjeta" },
  { valor: "otro", etiqueta: "Otro" },
] as const;
export type TipoMedio = (typeof TIPOS_MEDIO)[number]["valor"];

export const etiquetaTipoMedio = (t: string) => TIPOS_MEDIO.find((x) => x.valor === t)?.etiqueta ?? "Otro";

export type MedioPago = {
  id: number;
  nombre: string;
  tipo: TipoMedio;
  pideId: boolean; // muestra el campo ID (nº de transferencia / operación)
  activo: boolean;
  orden: number;
  usos: number; // pagos que lo usan (no se puede borrar, solo desactivar)
};

export const medioSchema = z.object({
  nombre: z.string().trim().min(1, "Poné un nombre").max(40),
  tipo: z.enum(["caja", "banco", "tarjeta", "otro"]),
  pideId: z.boolean(),
  activo: z.boolean().optional(),
});
export type MedioInput = z.infer<typeof medioSchema>;

export const mismoNombre = (a: string, b: string) => a.trim().toLocaleLowerCase("es") === b.trim().toLocaleLowerCase("es");

// Medios que se ofrecen en un selector: los activos y, si se está editando un pago
// con un medio ya desactivado, también ese (para no perderlo).
export function mediosParaElegir(medios: MedioPago[] | undefined, actual?: string | null): MedioPago[] {
  const lista = (medios ?? []).filter((m) => m.activo || (actual != null && m.nombre === actual));
  return [...lista].sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre, "es"));
}
