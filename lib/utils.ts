import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const ARS = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

export function fmtARS(value: number | undefined | null): string {
  return value != null ? ARS.format(value) : "—";
}

// Con decimales — solo para montos cargados manualmente (ej. Flujo de caja) donde los centavos importan.
export const ARS_DECIMAL = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function fmtARSDecimal(value: number | undefined | null): string {
  return value != null ? ARS_DECIMAL.format(value) : "—";
}

export function fmtDate(date: string | Date | null | undefined): string {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("es-AR", { timeZone: "UTC" });
}

export function normalize(s: string | null | undefined): string {
  if (!s) return "—";
  return s === s.toUpperCase()
    ? s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
    : s;
}

export function slugify(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/\s+/g, "-");
}
