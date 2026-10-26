// Qué tan al día están los datos de un PDV: verde = hasta ayer, ámbar = 2-3
// días atrás, rojo = más viejo (chip "actualizado al", Diego 26/10/2026).
export type Frescura = "al_dia" | "atrasado" | "viejo";

// hoyISO = "YYYY-MM-DD" en hora de Argentina.
export function diasAtras(fechaISO: string, hoyISO: string): number {
  const d = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  return Math.round((d(hoyISO) - d(fechaISO)) / 86_400_000);
}

export function frescura(fechaISO: string, hoyISO: string): Frescura {
  const n = diasAtras(fechaISO, hoyISO);
  if (n <= 1) return "al_dia";
  if (n <= 3) return "atrasado";
  return "viejo";
}

export function hoyArgentina(ahora = new Date()): string {
  return new Date(ahora.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
}
