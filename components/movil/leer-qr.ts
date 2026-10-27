"use client";

// Lee el QR de una foto en el mismo celular (gratis, sin mandar la foto a ningún lado):
// BarcodeDetector si el navegador lo tiene (Chrome / Android); si no (iPhone), jsQR
// 1.4.0 (Apache 2.0), que se carga recién acá desde jsDelivr con verificación de
// integridad (SRI): si el archivo no es exactamente ese, el navegador no lo ejecuta.

type Fuente = ImageBitmap | HTMLImageElement;

async function abrirImagen(file: File): Promise<Fuente> {
  if (typeof createImageBitmap === "function") {
    try { return await createImageBitmap(file); } catch { /* sigue con <img> */ }
  }
  // data: (la política de seguridad del Panel permite data:, no blob:)
  const url = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(file); });
  return await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
}

type JsQr = (d: Uint8ClampedArray, w: number, h: number, o?: { inversionAttempts?: string }) => { data: string } | null;
let cargando: Promise<JsQr> | null = null;
function cargarJsQr(): Promise<JsQr> {
  const w = window as unknown as { jsQR?: JsQr };
  if (w.jsQR) return Promise.resolve(w.jsQR);
  cargando ??= new Promise<JsQr>((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js";
    s.integrity = "sha384-b5Ya4Bq3qCyz39m2ISh+4DxjAIljdeFwK/BsXLuj9gugaNwAcj/ia15fxNZL9Nlx";
    s.crossOrigin = "anonymous";
    s.onload = () => (w.jsQR ? res(w.jsQR) : rej(new Error("jsQR")));
    s.onerror = () => { cargando = null; rej(new Error("jsQR")); };
    document.head.appendChild(s);
  });
  return cargando;
}

export async function leerQrDeArchivo(file: File): Promise<string | null> {
  const img = await abrirImagen(file);
  const W = "naturalWidth" in img ? img.naturalWidth : img.width;
  const H = "naturalHeight" in img ? img.naturalHeight : img.height;

  const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => { detect: (s: Fuente) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
  if (BD) {
    try {
      const r = await new BD({ formats: ["qr_code"] }).detect(img);
      const qr = r.find((x) => x.rawValue)?.rawValue;
      if (qr) return qr;
    } catch { /* sigue con jsQR */ }
  }
  const jsQR = await cargarJsQr();
  // Varias escalas: el QR de una factura es chico dentro de una foto grande.
  for (const lado of [1600, 2400, 1000]) {
    const k = Math.min(1, lado / Math.max(W, H));
    const w = Math.round(W * k), h = Math.round(H * k);
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) break;
    ctx.drawImage(img, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h);
    const r = jsQR(d.data, w, h, { inversionAttempts: "attemptBoth" });
    if (r?.data) return r.data;
    if (k === 1) break; // la foto ya es chica: no hay otra escala que probar
  }
  return null;
}
