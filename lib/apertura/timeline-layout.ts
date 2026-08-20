// Calcula la posición/ancho (en %) de cada regla existente en la línea de
// tiempo visual del modal de apertura de gastos (Fase C) — puro en el sentido
// de no depender de DB/React, aunque SÍ usa Date.now() para extender el eje
// hasta "hoy" cuando todas las fechas conocidas quedaron en el pasado (así
// una regla "desde_adelante" con fecha ya vencida sigue teniendo un tramo
// visible en vez de colapsar a un punto). Por eso los tests no aseveran
// porcentajes exactos para segmentos cuyo eje depende de "hoy" — solo
// invariantes que no cambian con la fecha de ejecución.

export interface TimelineReglaInput {
  id: number | "nueva";
  estado: "activa" | "inactiva" | "nueva";
  modo: "historico" | "entre_fechas" | "desde_adelante" | "desde_atras";
  fechaDesde: Date | null;
  fechaHasta: Date | null;
}

export interface TimelineSegmento {
  id: number | "nueva";
  estado: "activa" | "inactiva" | "nueva";
  leftPct: number;
  widthPct: number;
  fadeInicio: boolean;
  fadeFin: boolean;
  label: string;
}

const DIA_MS = 24 * 60 * 60 * 1000;
const ANCHO_MINIMO_PCT = 2;

function fmt(d: Date): string {
  // timeZone: "UTC" es necesario porque las fechas de vigencia llegan como
  // fecha-calendario pura (medianoche UTC, ej. new Date("2026-01-01")) — sin
  // fijar la zona, toLocaleDateString usa la zona local de quien ejecuta y
  // puede mostrar el día calendario anterior (ej. en UTC-3, "01/01/2026" se
  // veía como "31/12/2025").
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
}

// Una regla está "completa" cuando tiene todas las fechas que su modo exige.
// El modal arma una entrada sintética ("nueva") con el estado EN CURSO del
// formulario, así que recibimos rutinariamente reglas a medio llenar (ej.
// entre_fechas con solo "Desde" tipeado). Esta función es el guard que hace
// total a calcularSegmentosTimeline: nunca puede tirar (hallazgo Critical de
// la revisión final de rama, Fase C).
function esCompleta(r: TimelineReglaInput): boolean {
  switch (r.modo) {
    case "historico":
      return true;
    case "entre_fechas":
      return r.fechaDesde !== null && r.fechaHasta !== null;
    case "desde_adelante":
      return r.fechaDesde !== null;
    case "desde_atras":
      return r.fechaHasta !== null;
  }
}

function segmentoHistorico(r: TimelineReglaInput): TimelineSegmento {
  return { id: r.id, estado: r.estado, leftPct: 0, widthPct: 100, fadeInicio: false, fadeFin: false, label: "Histórico completo" };
}

function segmentoIncompleto(r: TimelineReglaInput): TimelineSegmento {
  return { id: r.id, estado: r.estado, leftPct: 0, widthPct: 0, fadeInicio: false, fadeFin: false, label: "Vigencia incompleta" };
}

export function calcularSegmentosTimeline(reglas: TimelineReglaInput[]): TimelineSegmento[] {
  // Solo las reglas completas aportan fechas al eje: una fecha suelta de una
  // regla a medio llenar no debe estirar/deformar el eje del resto.
  const fechasFinitas = reglas
    .filter(esCompleta)
    .flatMap((r) => [r.fechaDesde, r.fechaHasta])
    .filter((d): d is Date => d !== null);

  if (fechasFinitas.length === 0) {
    // No hay eje temporal que dibujar: las historico ocupan el ancho completo
    // (se apilan visualmente, una fila por regla, ver apertura-timeline.tsx) y
    // las que esperan una fecha quedan como placeholder sin ancho.
    return reglas.map((r) => (r.modo === "historico" ? segmentoHistorico(r) : segmentoIncompleto(r)));
  }

  const tiempos = fechasFinitas.map((d) => d.getTime());
  const minFinito = Math.min(...tiempos);
  const maxFinito = Math.max(...tiempos, Date.now());
  const padding = Math.max((maxFinito - minFinito) * 0.05, 7 * DIA_MS);
  const inicioEje = minFinito - padding;
  const finEje = maxFinito + padding;
  const rango = finEje - inicioEje || 1;

  return reglas.map((r) => {
    if (r.modo === "historico") return segmentoHistorico(r);
    // Corta ANTES de cualquier `!` — el resto de la función asume fechas presentes.
    if (!esCompleta(r)) return segmentoIncompleto(r);
    if (r.modo === "entre_fechas") {
      const left = ((r.fechaDesde!.getTime() - inicioEje) / rango) * 100;
      const width = Math.max(((r.fechaHasta!.getTime() - r.fechaDesde!.getTime()) / rango) * 100, ANCHO_MINIMO_PCT);
      return {
        id: r.id,
        estado: r.estado,
        leftPct: left,
        widthPct: width,
        fadeInicio: false,
        fadeFin: false,
        label: `${fmt(r.fechaDesde!)} — ${fmt(r.fechaHasta!)}`,
      };
    }
    if (r.modo === "desde_adelante") {
      const left = ((r.fechaDesde!.getTime() - inicioEje) / rango) * 100;
      return { id: r.id, estado: r.estado, leftPct: left, widthPct: 100 - left, fadeInicio: false, fadeFin: true, label: `Desde ${fmt(r.fechaDesde!)}` };
    }
    // desde_atras
    const width = ((r.fechaHasta!.getTime() - inicioEje) / rango) * 100;
    return { id: r.id, estado: r.estado, leftPct: 0, widthPct: width, fadeInicio: true, fadeFin: false, label: `Hasta ${fmt(r.fechaHasta!)}` };
  });
}
