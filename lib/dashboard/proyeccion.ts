// Proyección de cierre de un mes con ventas incompletas (tooltip de Ingresos).
//
// Método: cada día que falta vale lo que suele vender ese día de la semana
// (promedio de las últimas 8 semanas hasta el corte) × el ritmo del mes
// (lo facturado hasta el corte ÷ lo que se esperaba facturar hasta el corte
// con ese mismo promedio). Al lado se informan la regla de 3 y "mismo ritmo
// que el año anterior" para comparar, y un rango que sale del error que tuvo
// este mismo cálculo en los meses anteriores cortando el mismo día.
//
// Puro (sin DB): recibe las ventas diarias y la fecha de corte.

export type VentaDia = { fecha: string; total: number }; // fecha YYYY-MM-DD

export interface ProyeccionMes {
  anio: number;
  mes: number; // 1-12
  corte: string; // último día con ventas (YYYY-MM-DD)
  diasMes: number;
  diasTranscurridos: number;
  diasRestantes: number;
  facturado: number;
  estimadoRestante: number;
  proyeccion: number;
  ritmo: number; // 1 = vende como siempre
  // Cantidad de días que faltan por día de semana (0 = domingo), en el orden en que aparecen.
  restantesPorDia: { dow: number; cantidad: number }[];
  reglaDeTres: number;
  mismoRitmoAnioAnterior: number | null;
  cierreAnioAnterior: number | null;
  // Error medio del método y de la regla de 3 en los meses anteriores (fracción, 0.05 = 5%).
  backtest: { meses: number; dia: number; errorMetodo: number; errorReglaDeTres: number } | null;
  rango: { min: number; max: number } | null;
}

const VENTANA_DIAS = 56; // 8 semanas
const MESES_BACKTEST = 6;

const DIA_MS = 86_400_000;

function aMs(fecha: string): number {
  const [y, m, d] = fecha.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function aFecha(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function diasDelMes(anio: number, mes: number): number {
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate();
}

function dow(ms: number): number {
  return new Date(ms).getUTCDay();
}

type Serie = { porDia: Map<string, number>; primerDia: number };

function armarSerie(dias: VentaDia[]): Serie {
  const porDia = new Map<string, number>();
  let primerDia = Infinity;
  for (const d of dias) {
    porDia.set(d.fecha, (porDia.get(d.fecha) ?? 0) + d.total);
    const ms = aMs(d.fecha);
    if (ms < primerDia) primerDia = ms;
  }
  return { porDia, primerDia };
}

const venta = (s: Serie, ms: number) => s.porDia.get(aFecha(ms)) ?? 0;

function sumaRango(s: Serie, desdeMs: number, hastaMs: number): number {
  let t = 0;
  for (let ms = desdeMs; ms <= hastaMs; ms += DIA_MS) t += venta(s, ms);
  return t;
}

// Núcleo: estimación del cierre del mes de `corteMs` usando solo datos hasta el corte.
function estimar(s: Serie, corteMs: number) {
  const c = new Date(corteMs);
  const anio = c.getUTCFullYear();
  const mes = c.getUTCMonth() + 1;
  const inicioMes = Date.UTC(anio, mes - 1, 1);
  const finMes = Date.UTC(anio, mes - 1, diasDelMes(anio, mes));

  // Promedio por día de semana en la ventana (los días sin ventas cuentan como 0:
  // si el local cierra los lunes, el lunes vale 0).
  const desde = Math.max(corteMs - (VENTANA_DIAS - 1) * DIA_MS, s.primerDia);
  const suma = new Array(7).fill(0);
  const cant = new Array(7).fill(0);
  for (let ms = desde; ms <= corteMs; ms += DIA_MS) {
    suma[dow(ms)] += venta(s, ms);
    cant[dow(ms)] += 1;
  }
  const totalVentana = suma.reduce((a, b) => a + b, 0);
  const diasVentana = cant.reduce((a, b) => a + b, 0);
  const promGeneral = diasVentana > 0 ? totalVentana / diasVentana : 0;
  const prom = suma.map((v, i) => (cant[i] > 0 ? v / cant[i] : promGeneral));

  let esperadoHasta = 0;
  for (let ms = inicioMes; ms <= corteMs; ms += DIA_MS) esperadoHasta += prom[dow(ms)];
  const facturado = sumaRango(s, inicioMes, corteMs);
  const ritmo = esperadoHasta > 0 ? facturado / esperadoHasta : 1;

  let restante = 0;
  for (let ms = corteMs + DIA_MS; ms <= finMes; ms += DIA_MS) restante += prom[dow(ms)] * ritmo;

  const diasMes = diasDelMes(anio, mes);
  const diasTranscurridos = Math.round((corteMs - inicioMes) / DIA_MS) + 1;
  return {
    anio, mes, inicioMes, finMes, diasMes, diasTranscurridos,
    facturado, ritmo, restante, proyeccion: facturado + restante,
    reglaDeTres: diasTranscurridos > 0 ? (facturado / diasTranscurridos) * diasMes : 0,
  };
}

export function proyectarMes(dias: VentaDia[], corte: string): ProyeccionMes | null {
  if (!dias.length) return null;
  const s = armarSerie(dias);
  const corteMs = aMs(corte);
  const e = estimar(s, corteMs);
  if (e.diasTranscurridos >= e.diasMes || e.facturado <= 0) return null;

  // Días que faltan agrupados por día de semana, en orden de aparición.
  const orden: number[] = [];
  const cuenta = new Map<number, number>();
  for (let ms = corteMs + DIA_MS; ms <= e.finMes; ms += DIA_MS) {
    const d = dow(ms);
    if (!cuenta.has(d)) orden.push(d);
    cuenta.set(d, (cuenta.get(d) ?? 0) + 1);
  }

  // Mismo mes del año anterior.
  const lyInicio = Date.UTC(e.anio - 1, e.mes - 1, 1);
  const lyDias = diasDelMes(e.anio - 1, e.mes);
  const lyFin = Date.UTC(e.anio - 1, e.mes - 1, lyDias);
  const lyCorte = Date.UTC(e.anio - 1, e.mes - 1, Math.min(e.diasTranscurridos, lyDias));
  const hayLy = s.primerDia <= lyInicio;
  const cierreLy = hayLy ? sumaRango(s, lyInicio, lyFin) : 0;
  const lyHasta = hayLy ? sumaRango(s, lyInicio, lyCorte) : 0;

  // Backtest: los meses anteriores, cortados el mismo día del mes.
  const errM: number[] = [];
  const errR: number[] = [];
  for (let k = 1; k <= MESES_BACKTEST; k++) {
    const a = new Date(Date.UTC(e.anio, e.mes - 1 - k, 1));
    const ba = a.getUTCFullYear();
    const bm = a.getUTCMonth() + 1;
    const bDias = diasDelMes(ba, bm);
    const bInicio = Date.UTC(ba, bm - 1, 1);
    // Necesita la ventana completa de historia antes del corte para ser comparable.
    const bCorte = Date.UTC(ba, bm - 1, Math.min(e.diasTranscurridos, bDias - 1));
    if (bCorte - (VENTANA_DIAS - 1) * DIA_MS < s.primerDia) break;
    const real = sumaRango(s, bInicio, Date.UTC(ba, bm - 1, bDias));
    if (real <= 0) continue;
    const b = estimar(s, bCorte);
    errM.push(Math.abs(b.proyeccion - real) / real);
    errR.push(Math.abs(b.reglaDeTres - real) / real);
  }
  const media = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const backtest = errM.length
    ? { meses: errM.length, dia: e.diasTranscurridos, errorMetodo: media(errM), errorReglaDeTres: media(errR) }
    : null;
  // Lo ya facturado es seguro: el error se aplica solo sobre la parte estimada,
  // pero expresado sobre el total (así lo midió el backtest).
  const rango = backtest
    ? { min: e.proyeccion * (1 - backtest.errorMetodo), max: e.proyeccion * (1 + backtest.errorMetodo) }
    : null;
  if (rango && rango.min < e.facturado) rango.min = e.facturado;

  return {
    anio: e.anio,
    mes: e.mes,
    corte,
    diasMes: e.diasMes,
    diasTranscurridos: e.diasTranscurridos,
    diasRestantes: e.diasMes - e.diasTranscurridos,
    facturado: e.facturado,
    estimadoRestante: e.restante,
    proyeccion: e.proyeccion,
    ritmo: e.ritmo,
    restantesPorDia: orden.map((d) => ({ dow: d, cantidad: cuenta.get(d)! })),
    reglaDeTres: e.reglaDeTres,
    mismoRitmoAnioAnterior: hayLy && lyHasta > 0 && cierreLy > 0 ? cierreLy * (e.facturado / lyHasta) : null,
    cierreAnioAnterior: hayLy && cierreLy > 0 ? cierreLy : null,
    backtest,
    rango,
  };
}

// Decide si hay que proyectar: el último día con ventas cae antes de fin de mes
// y ese mes es el actual (o el anterior durante los primeros días, mientras
// se termina de importar). Un PDV que dejó de vender hace meses no se proyecta.
export function debeProyectar(ultimoDia: string | null, hoy: string): boolean {
  if (!ultimoDia) return false;
  const [uy, um, ud] = ultimoDia.split("-").map(Number);
  if (ud >= diasDelMes(uy, um)) return false;
  const [hy, hm, hd] = hoy.split("-").map(Number);
  const mesesAtras = (hy - uy) * 12 + (hm - um);
  if (mesesAtras === 0) return true;
  return mesesAtras === 1 && hd <= 7;
}

export const DIA_SEMANA_CORTO = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"] as const;

// "$ 95,2 M" — compacto para el chip.
export function fmtMillones(v: number): string {
  if (Math.abs(v) >= 1_000_000) {
    return `$ ${(v / 1_000_000).toLocaleString("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} M`;
  }
  return `$ ${Math.round(v / 1000).toLocaleString("es-AR")} mil`;
}
