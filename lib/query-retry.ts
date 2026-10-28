// Reintentos de las consultas del Panel (Diego 28/10/2026). Antes cada pantalla reintentaba 2–3
// veces cualquier error: con la base saturada (timeouts) cada recarga multiplicaba los pedidos y
// la base no salía del pozo. Ahora: UN reintento, a los 3 s, y solo si el error parece pasajero
// (sin respuesta del servidor, o 502/503). Un 500/504 (timeout de la base) o un 4xx no se reintenta.

export class HttpError extends Error {
  constructor(public status: number, message = "Error cargando datos") {
    super(message);
    this.name = "HttpError";
  }
}

export const MAX_REINTENTOS = 1;

export function debeReintentar(fallos: number, error: unknown): boolean {
  if (fallos >= MAX_REINTENTOS) return false;
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status !== "number") return true; // red caída / sin respuesta
  return status === 502 || status === 503;
}

export const demoraReintento = () => 3000;

export const REINTENTOS = { retry: debeReintentar, retryDelay: demoraReintento } as const;
