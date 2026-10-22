import type { ReglaAperturaDTO } from "./types";

// ⚠ Este módulo lo importa un componente CLIENTE (apertura-gastos-modal.tsx),
// así que NO puede importar nada que arrastre @prisma/client al navegador.
// lib/apertura/vigencia.ts importa Prisma y evalúa `Prisma.sql` al cargar
// (FECHA_EFECTIVA_COMPRA_SQL) — en el browser eso tira al importar y rompe
// el Panel entero (incidente real 21/10/2026: PR #2 dejó producción sin
// cargar y hubo que hacer rollback). Por eso la ventana de vigencia se
// replica acá, pura, y estado-vigencia.test.ts verifica que da lo mismo
// que fechaEnVigencia y que este archivo no importa de "./vigencia".

// Estado de una regla "a la vista" en la lista del modal de apertura. Hasta
// oct-2026 la card solo mostraba el flag persistido `estado` (Activa /
// Inactiva), así que una regla con vigencia ya vencida seguía diciendo
// "Activa" (caso real: Vanesa Judit, última regla hasta 30/09/2026) y no
// había forma de ver de un vistazo cuál cubre HOY. Este módulo es puro para
// poder testearlo sin React; la card solo lo consume.
//
// - "vigente":  estado activa y la ventana de vigencia cubre hoy (sin fecha
//               de fin = sigue vigente).
// - "vencida":  estado activa pero la ventana terminó antes de hoy.
// - "proxima":  estado activa pero la ventana arranca después de hoy.
// - "inactiva": estado inactiva (desactivada a mano), cualquiera sea la fecha.
export type EstadoVigenciaRegla = "vigente" | "vencida" | "proxima" | "inactiva";

type ReglaParaEstado = Pick<ReglaAperturaDTO, "modo" | "fechaDesde" | "fechaHasta" | "extremosInclusivos" | "estado">;

// Las fechas del DTO viajan como ISO datetime a medianoche UTC ("2026-09-30T00:00:00.000Z").
function fechaUTC(iso: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

// "Hoy" como medianoche UTC del día calendario local, para comparar contra
// fechas de regla que también están a medianoche UTC (ver fechaISOConHora en
// el modal). Sin esto, a la noche en Argentina `new Date()` ya es "mañana"
// en UTC y una regla que vence hoy aparecería vencida antes de tiempo.
export function hoyUTC(ahora: Date = new Date()): Date {
  return new Date(Date.UTC(ahora.getFullYear(), ahora.getMonth(), ahora.getDate()));
}

// Misma semántica de extremos que fechaEnVigencia (lib/apertura/vigencia.ts):
// inclusivo → >= / <=, exclusivo → > / <. Devuelve null si al modo le falta
// la fecha que exige (dato inconsistente) en vez de tirar como aquella.
export function cubreFecha(
  fecha: Date,
  regla: Pick<ReglaParaEstado, "modo" | "extremosInclusivos">,
  desde: Date | null,
  hasta: Date | null
): boolean | null {
  const t = fecha.getTime();
  const inc = regla.extremosInclusivos;
  switch (regla.modo) {
    case "historico":
      return true;
    case "entre_fechas":
      if (!desde || !hasta) return null;
      return inc ? t >= desde.getTime() && t <= hasta.getTime() : t > desde.getTime() && t < hasta.getTime();
    case "desde_adelante":
      if (!desde) return null;
      return inc ? t >= desde.getTime() : t > desde.getTime();
    case "desde_atras":
      if (!hasta) return null;
      return inc ? t <= hasta.getTime() : t < hasta.getTime();
  }
}

export function estadoVigenciaRegla(regla: ReglaParaEstado, hoy: Date = hoyUTC()): EstadoVigenciaRegla {
  if (regla.estado !== "activa") return "inactiva";
  const desde = fechaUTC(regla.fechaDesde);
  const hasta = fechaUTC(regla.fechaHasta);
  if (cubreFecha(hoy, regla, desde, hasta) === true) return "vigente";
  if (desde && hoy.getTime() < desde.getTime()) return "proxima";
  return "vencida";
}

export const ETIQUETA_ESTADO: Record<EstadoVigenciaRegla, string> = {
  vigente: "Vigente",
  vencida: "Vencida",
  proxima: "Próxima",
  inactiva: "Inactiva",
};

// dd/mm/aaaa a partir del ISO del DTO, sin pasar por la zona horaria del
// navegador (mismo criterio que lib/dashboard/fecha-observacion.ts).
export function formatFechaRegla(iso: string | null): string | null {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
}

// Texto de la vigencia en la card. Antes: "2026-07-01 — 2026-09-30" /
// "Desde 2026-07-01"; ahora dd/mm/aaaa y, cuando falta un extremo, se dice
// explícitamente (Diego, 21/10/2026: "sin fecha de inicio/fin").
export function resumenVigencia(regla: Pick<ReglaAperturaDTO, "modo" | "fechaDesde" | "fechaHasta">): string {
  const desde = formatFechaRegla(regla.fechaDesde);
  const hasta = formatFechaRegla(regla.fechaHasta);
  switch (regla.modo) {
    case "historico":
      return "Histórico completo";
    case "entre_fechas":
      return `${desde ?? "sin fecha de inicio"} — ${hasta ?? "sin fecha de fin"}`;
    case "desde_adelante":
      return `Desde ${desde ?? "?"} · sin fecha de fin`;
    case "desde_atras":
      return `Sin fecha de inicio · hasta ${hasta ?? "?"}`;
  }
}

// Orden de la lista: de la más nueva a la más vieja por INICIO de vigencia
// (no por fecha de creación, que es lo que se usaba y no dice nada al
// usuario). Histórico completo y "sin fecha de inicio" cuentan como el
// inicio más antiguo posible. Empate → la creada más recientemente primero.
function inicioVigencia(regla: Pick<ReglaAperturaDTO, "modo" | "fechaDesde">): number {
  if (regla.modo === "historico" || regla.modo === "desde_atras") return Number.NEGATIVE_INFINITY;
  const d = fechaUTC(regla.fechaDesde);
  return d ? d.getTime() : Number.NEGATIVE_INFINITY;
}

export function ordenarReglas<T extends Pick<ReglaAperturaDTO, "modo" | "fechaDesde" | "creadoEn">>(reglas: T[]): T[] {
  return [...reglas].sort((a, b) => {
    const ia = inicioVigencia(a);
    const ib = inicioVigencia(b);
    if (ia !== ib) return ib > ia ? 1 : -1;
    return b.creadoEn.localeCompare(a.creadoEn);
  });
}

// "50.00" (Decimal serializado) → "50"; "33.33" → "33,33".
export function formatPorcentaje(porcentaje: string | number): string {
  const n = Number(porcentaje);
  if (!Number.isFinite(n)) return String(porcentaje);
  return n.toLocaleString("es-AR", { maximumFractionDigits: 2 });
}

export function hayReglaVigente(reglas: ReglaParaEstado[], hoy: Date = hoyUTC()): boolean {
  return reglas.some((r) => estadoVigenciaRegla(r, hoy) === "vigente");
}
