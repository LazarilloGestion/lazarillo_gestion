// Gastos Varios cargados en Lazarillo (Etapa 4). Un gasto vario se guarda como un
// Ticket del proveedor "Gastos Varios" (código GV) con número interno 9999-NNNNNNNN:
// así entra a la vista Económica por su fecha, a la Financiera por su pago, y si queda
// sin pagar aparece en Impagas y en la cta cte de Gastos Varios (Diego, 27/10/2026).
// Se elige primero el PERÍODO (mes) y la fecha va al 15 de ese mes salvo que se cambie.

export const GV_CODIGO = "GV";
export const GV_NOMBRE = "Gastos Varios";
export const GV_PREFIJO = "9999";
export const GV_DIA = 15;

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const p2 = (n: number) => String(n).padStart(2, "0");

/** "2026-10" → "2026-10-15". */
export function fechaDelPeriodo(periodo: string): string {
  return `${periodo}-${p2(GV_DIA)}`;
}

/** "2026-10-27" → "2026-10". */
export function periodoDe(fechaISO: string): string {
  return fechaISO.slice(0, 7);
}

/** Corre el período n meses (‹ ›). */
export function moverPeriodo(periodo: string, n: number): string {
  const [y, m] = periodo.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${p2((t % 12) + 1)}`;
}

/** "2026-10" → "Octubre 2026". */
export function nombrePeriodo(periodo: string): string {
  const [y, m] = periodo.split("-").map(Number);
  return `${MESES[m - 1] ?? "?"} ${y}`;
}

/** Siguiente número interno a partir del mayor comprobante GV ("Z9999" + 8 dígitos). */
export function siguienteNumeroGV(mayor: string | null | undefined): string {
  const n = mayor && /^Z\d{4}\d{8}$/.test(mayor) ? Number(mayor.slice(5)) : 0;
  return String(n + 1).padStart(8, "0");
}
