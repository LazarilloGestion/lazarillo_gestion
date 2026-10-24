// Service worker "de baja". Antes el panel se publicaba como PWA (next-pwa) y
// el navegador quedó con un service worker que sirve la versión vieja de la
// app desde su caché: por eso los cambios solo se veían en incógnito. Hoy el
// build (turbopack) ya no genera /sw.js; este reemplazo hace que ese service
// worker viejo se actualice a esta versión, borre sus cachés, se desregistre
// y recargue las pestañas abiertas con la versión nueva.
const SCRIPT = `
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const claves = await caches.keys();
    await Promise.all(claves.map((k) => caches.delete(k)));
    await self.registration.unregister();
    const ventanas = await self.clients.matchAll({ type: "window" });
    for (const v of ventanas) v.navigate(v.url);
  })());
});
`;

export function GET() {
  return new Response(SCRIPT, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Service-Worker-Allowed": "/",
    },
  });
}
