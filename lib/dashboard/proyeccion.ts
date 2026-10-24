// Proyección de cierre de un mes con ventas incompletas (tooltip de Ingresos).
//
// Dos métodos, se usa el que menos erró en ese local/PDV:
//  - "semanas": cada día que falta vale lo que suele vender ese día de la
//    semana (promedio de las últimas 8 semanas) × el ritmo del mes (lo
//    facturado hasta el corte ÷ lo esperado hasta el corte con ese promedio).
//  - "dias_mes" (idea de Diego): cada día que falta vale el promedio de ese
//    mismo día de la semana dentro del mes en curso. Si ese día todavía no
//    pasó en el mes (ej. el día 3 sin sábados), usa el de "semanas".
// El error de cada uno sale de las proyecciones guardadas día a día (cuando
// hay al menos 3 meses cerrados) o, mientras tanto, de repetir el cálculo en
// los 6 meses anteriores cortando el mismo día. Al lado se informan la regla
// de 3 y "mismo ritmo que el año anterior", y un rango con ese error.
//
// Puro (sin DB): recibe las ventas diarias y la fecha de corte.

export type VentaDia = { fecha: string; total: number }; // fecha YYYY-MM-DD
export type Metodo = "semanas" | "dias_mes";
export const METODOS: Metodo[] = ["semanas", "dias_mes"];
// Proyección guardada un día cualquiera de un mes (tabla proyecciones_ingresos).
export type ProyeccionGuardada = { anio: number; mes: number; metodo: Metodo; proyeccion: number };

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
  metodo: Metodo; // el que se usa (menor error)
  proyecciones: Record<Metodo, number>; // los dos, para guardarlos y comparar
  ritmo: number; // 1 = vende como siempre (método "semanas")
  // Cantidad de días que faltan por día de semana (0 = domingo), en el orden en que aparecen.
  restantesPorDia: { dow: number; cantidad: number }[];
  reglaDeTres: number;
  mismoRitmoAnioAnterior: number | null;
  cierreAnioAnterior: number | null;
  // Error medio de cada método y de la regla de 3 (fracción, 0.05 = 5%).
  // fuente "guardadas" = proyecciones reales guardadas día a día contra el cierre;
  // "backtest" = repitiendo el cálculo en meses anteriores cortando el mismo día.
  backtest: {
    fuente: "guardadas" | "backtest";
    meses: number;
    dia: number;
    errorMetodo: number;
    errores: Record<Metodo, number>;
    errorReglaDeTres: number | null;
  } | null;
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
function estimar(s: Serie, corteMs: number, metodo: Metodo = "semanas") {
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
  const sumaMes = new Array(7).fill(0);
  const cantMes = new Array(7).fill(0);
  for (let ms = inicioMes; ms <= corteMs; ms += DIA_MS) {
    esperadoHasta += prom[dow(ms)];
    sumaMes[dow(ms)] += venta(s, ms);
    cantMes[dow(ms)] += 1;
  }
  const facturado = sumaMes.reduce((a, b) => a + b, 0);
  const ritmo = esperadoHasta > 0 ? facturado / esperadoHasta : 1;

  let restante = 0;
  for (let ms = corteMs + DIA_MS; ms <= finMes; ms += DIA_MS) {
    const d = dow(ms);
    restante += metodo === "dias_mes" && cantMes[d] > 0 ? sumaMes[d] / cantMes[d] : prom[d] * ritmo;
  }

  const diasMes = diasDelMes(anio, mes);
  const diasTranscurridos = Math.round((corteMs - inicioMes) / DIA_MS) + 1;
  return {
    anio, mes, inicioMes, finMes, diasMes, diasTranscurridos,
    facturado, ritmo, restante, proyeccion: facturado + restante,
    reglaDeTres: diasTranscurridos > 0 ? (facturado / diasTranscurridos) * diasMes : 0,
  };
}

export function proyectarMes(
  dias: VentaDia[],
  corte: string,
  guardadas: ProyeccionGuardada[] = [],
): ProyeccionMes | null {
  if (!dias.length) return null;
  const s = armarSerie(dias);
  const corteMs = aMs(corte);
  const e = estimar(s, corteMs, "semanas");
  const eMes = estimar(s, corteMs, "dias_mes");
  const proyecciones: Record<Metodo, number> = { semanas: e.proyeccion, dias_mes: eMes.proyeccion };
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
  const errBt: Record<Metodo, number[]> = { semanas: [], dias_mes: [] };
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
    for (const m of METODOS) errBt[m].push(Math.abs(estimar(s, bCorte, m).proyeccion - real) / real);
    errR.push(Math.abs(estimar(s, bCorte).reglaDeTres - real) / real);
  }
  const media = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

  // Proyecciones guardadas de meses ya cerrados (anteriores al del corte) contra su cierre real.
  const errG: Record<Metodo, number[]> = { semanas: [], dias_mes: [] };
  const mesesG = new Set<string>();
  const realMes = new Map<string, number>();
  for (const g of guardadas) {
    if (g.anio * 12 + g.mes >= e.anio * 12 + e.mes) continue;
    const clave = `${g.anio}-${g.mes}`;
    if (!realMes.has(clave)) {
      const ini = Date.UTC(g.anio, g.mes - 1, 1);
      realMes.set(clave, ini >= s.primerDia ? sumaRango(s, ini, Date.UTC(g.anio, g.mes - 1, diasDelMes(g.anio, g.mes))) : 0);
    }
    const real = realMes.get(clave)!;
    if (real <= 0 || !errG[g.metodo]) continue;
    errG[g.metodo].push(Math.abs(g.proyeccion - real) / real);
    mesesG.add(clave);
  }

  let backtest: ProyeccionMes["backtest"] = null;
  if (mesesG.size >= 3 && METODOS.every((m) => errG[m].length > 0)) {
    const errores = { semanas: media(errG.semanas), dias_mes: media(errG.dias_mes) };
    backtest = { fuente: "guardadas", meses: mesesG.size, dia: e.diasTranscurridos, errorMetodo: 0, errores, errorReglaDeTres: errR.length ? media(errR) : null };
  } else if (errBt.semanas.length) {
    const errores = { semanas: media(errBt.semanas), dias_mes: media(errBt.dias_mes) };
    backtest = { fuente: "backtest", meses: errBt.semanas.length, dia: e.diasTranscurridos, errorMetodo: 0, errores, errorReglaDeTres: media(errR) };
  }
  // Se usa el que menos erró; empate o sin datos → "semanas".
  const metodo: Metodo = backtest && backtest.errores.dias_mes < backtest.errores.semanas ? "dias_mes" : "semanas";
  if (backtest) backtest.errorMetodo = backtest.errores[metodo];
  const elegido = metodo === "semanas" ? e : eMes;

  // Lo ya facturado es seguro: el rango nunca baja de ahí.
  const rango = backtest
    ? { min: elegido.proyeccion * (1 - backtest.errorMetodo), max: elegido.proyeccion * (1 + backtest.errorMetodo) }
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
    estimadoRestante: elegido.restante,
    proyeccion: elegido.proyeccion,
    metodo,
    proyecciones,
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
