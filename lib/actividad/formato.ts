// Campanita de Actividad (Diego, 27/10/2026): agrupada por día, con el día completo
// ("Hoy · martes 27/10", "Ayer · lunes 26/10", "Sábado 24/10").
const TZ = "America/Argentina/Buenos_Aires";

const diaISO = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: TZ }); // YYYY-MM-DD

export function etiquetaDia(fecha: Date, ahora: Date = new Date()): string {
  const hoy = diaISO(ahora);
  const ayer = diaISO(new Date(ahora.getTime() - 86_400_000));
  const d = diaISO(fecha);
  const semana = fecha.toLocaleDateString("es-AR", { weekday: "long", timeZone: TZ });
  const dm = `${d.slice(8, 10)}/${d.slice(5, 7)}`;
  if (d === hoy) return `Hoy · ${semana} ${dm}`;
  if (d === ayer) return `Ayer · ${semana} ${dm}`;
  const anio = d.slice(0, 4) !== hoy.slice(0, 4) ? `/${d.slice(0, 4)}` : "";
  return `${semana.charAt(0).toUpperCase()}${semana.slice(1)} ${dm}${anio}`;
}

export const horaDe = (fecha: Date) => fecha.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ });

export function agruparPorDia<T extends { creadoEn: string }>(items: T[], ahora: Date = new Date()): { dia: string; items: T[] }[] {
  const out: { dia: string; items: T[] }[] = [];
  for (const it of items) {
    const dia = etiquetaDia(new Date(it.creadoEn), ahora);
    const ult = out[out.length - 1];
    if (ult && ult.dia === dia) ult.items.push(it);
    else out.push({ dia, items: [it] });
  }
  return out;
}

export const TITULO_ACCION: Record<string, Record<string, string>> = {
  factura: { creada: "Factura cargada", editada: "Factura editada", eliminada: "Factura eliminada", restaurada: "Factura restaurada" },
};

// descripcion = "<nombre>\n<detalle>" (las viejas sin salto: todo es detalle).
export function partesDescripcion(descripcion: string): { nombre: string | null; detalle: string } {
  const i = descripcion.indexOf("\n");
  return i < 0 ? { nombre: null, detalle: descripcion } : { nombre: descripcion.slice(0, i), detalle: descripcion.slice(i + 1) };
}
