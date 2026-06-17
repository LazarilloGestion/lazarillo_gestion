// Preferencia de mostrar/ocultar la sección título+filtros del dashboard.
// Se guarda en cookie (no localStorage) para que el server la lea en SSR
// y renderice el estado correcto en el primer paint, sin flash.
export const FILTERS_COOKIE = "dash_filters";

// Client-only: persiste la preferencia para el próximo render del server.
export function writeFiltersCookie(open: boolean) {
  if (typeof document !== "undefined") {
    document.cookie = `${FILTERS_COOKIE}=${open ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
  }
}
