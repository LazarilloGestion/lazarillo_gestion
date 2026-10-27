// QR de los comprobantes electrónicos de ARCA (ex AFIP, RG 4892/2020). Puro: lo usa
// la carga desde el celular (Diego 27/10/2026: "Factura con foto", gratis y exacto).
// El QR es una URL https://www.afip.gob.ar/fe/qr/?p=<JSON en base64> (o arca.gob.ar)
// con: ver, fecha, cuit (emisor), ptoVta, tipoCmp, nroCmp, importe, moneda, ctz,
// tipoDocRec, nroDocRec, tipoCodAut, codAut. No trae renglones ni IVA desglosado.

export type TipoQr = "FcA" | "FcB" | "FcC" | "NC-A" | "Ticket";

export interface DatosQr {
  cuit: string;      // solo dígitos
  fecha: string;     // YYYY-MM-DD
  ptoVta: number;
  numero: number;
  tipoCmp: number;   // código ARCA
  tipo: TipoQr;      // como el modal de carga
  importe: number;   // total del comprobante
  moneda: string;
}

// Códigos ARCA → tipo de la carga. Tique factura A/B/C (81/82/83) cuentan como factura.
const TIPOS: Record<number, TipoQr> = {
  1: "FcA", 6: "FcB", 11: "FcC", 51: "FcA", 81: "FcA", 82: "FcB", 83: "FcC",
  3: "NC-A", 8: "NC-A", 13: "NC-A", 53: "NC-A",
};

function base64ATexto(b64: string): string {
  let s = b64.trim().replace(/-/g, "+").replace(/_/g, "/").replace(/\s/g, "");
  while (s.length % 4) s += "=";
  const bin = typeof atob === "function" ? atob(s) : Buffer.from(s, "base64").toString("binary");
  // UTF-8
  try { return decodeURIComponent(Array.from(bin, (c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0")).join("")); }
  catch { return bin; }
}

export function leerQrArca(texto: string): DatosQr | null {
  const t = texto.trim();
  let p: string | null = null;
  const m = /[?&]p=([^&#]+)/.exec(t);
  if (m) p = decodeURIComponent(m[1]);
  else if (/^[A-Za-z0-9+/=_-]{40,}$/.test(t)) p = t; // a veces el QR trae solo el base64
  if (!p) return null;
  let j: Record<string, unknown>;
  try { j = JSON.parse(base64ATexto(p)); } catch { return null; }
  const cuit = String(j.cuit ?? "").replace(/\D/g, "");
  const fecha = String(j.fecha ?? "").slice(0, 10);
  const tipoCmp = Number(j.tipoCmp), ptoVta = Number(j.ptoVta), numero = Number(j.nroCmp), importe = Number(j.importe);
  if (cuit.length !== 11 || !/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !Number.isFinite(importe) || !(numero > 0) || !(ptoVta >= 0)) return null;
  return { cuit, fecha, ptoVta, numero, tipoCmp, tipo: TIPOS[tipoCmp] ?? "Ticket", importe: Math.round(importe * 100) / 100, moneda: String(j.moneda ?? "PES") };
}

export const soloDigitos = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
