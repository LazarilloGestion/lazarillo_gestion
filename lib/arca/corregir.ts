import { Prisma } from "@prisma/client";

// Corregir con ARCA (Diego 28/10/2026): "número distinto y fecha distinta lo ajusta y fin";
// cargadas dos veces → anular la fantasma; importe distinto → análisis por partes.

export const COD_PERCEPCION = ["133", "899", "137"];

/** Una fila de compras de un comprobante, con sus renglones (25) y si tiene pagos (80). */
export interface FilaComprobante {
  rowId: string; comprobante: string; localId: number; fecha: string; concepto: string | null; cod: string | null;
  importe: number; origen: string | null; renNeto: number; renIva: number; renN: number; pagos: number; anulada: boolean;
}

export function filasComprobantesSql(pares: { comprobante: string; localId: number }[]): Prisma.Sql {
  return Prisma.sql`
    SELECT c."rowId", c.comprobante, c."localId", to_char(COALESCE(c."fechaManual", c.fecha), 'YYYY-MM-DD') AS fecha,
           TRIM(COALESCE(cc.nombre, c.concepto)) AS concepto,
           COALESCE(c."conceptoCodigoManual", c."conceptoCodigo", c."codCga") AS cod,
           COALESCE(c."importeManual", c.importe)::float8 AS importe, c.origen,
           COALESCE(d.neto, 0)::float8 AS "renNeto", COALESCE(d.iva, 0)::float8 AS "renIva", COALESCE(d.n, 0)::int AS "renN",
           (SELECT COUNT(*) FROM pagos p WHERE p.comprobante = c.comprobante AND p."localId" = c."localId")::int AS pagos,
           EXISTS (SELECT 1 FROM compras_huerfanas h WHERE h."rowId" = c."rowId" AND h.estado = 'aplicada') AS anulada
    FROM compras c
    JOIN unnest(${pares.map((p) => p.comprobante)}::text[], ${pares.map((p) => p.localId)}::int[]) AS q(comprobante, local_id)
      ON q.comprobante = c.comprobante AND q.local_id = c."localId"
    LEFT JOIN conceptos_caja cc ON cc.codigo = COALESCE(c."conceptoCodigoManual", c."conceptoCodigo")
    LEFT JOIN LATERAL (
      SELECT SUM(x.neto) AS neto, SUM(x.neto * COALESCE(x.tasa, 0) / 100) AS iva, COUNT(*) AS n
      FROM detalle_compras x WHERE x."compraId" = c."rowId") d ON true
    ORDER BY c.comprobante, COALESCE(c."importeManual", c.importe) DESC`;
}

export interface PartesArca { neto: number; iva: number; noGravado: number; exento: number; otros: number; total: number }
export interface Diagnostico {
  partes: { parte: string; arca: number; renglones: number | null; caja: number; ok: boolean }[];
  texto: string;
  /** Para "Igualar a ARCA": la fila principal y su importe nuevo (neto + IVA de ARCA menos las otras filas). */
  igualar: { rowId: string; importe: number } | null;
}

const $ = (n: number) => "$ " + Math.round(n).toLocaleString("es-AR");
const cerca = (a: number, b: number) => Math.abs(a - b) <= Math.max(2, Math.abs(b) * 0.01);

/** Dónde está la diferencia entre ARCA y lo cargado: neto + IVA (caja y renglones) y percepciones. */
export function diagnosticoImporte(a: PartesArca, filas: FilaComprobante[]): Diagnostico {
  const vivas = filas.filter((f) => !f.anulada);
  const percep = vivas.filter((f) => COD_PERCEPCION.includes(f.cod ?? ""));
  const resto = vivas.filter((f) => !COD_PERCEPCION.includes(f.cod ?? ""));
  const arcaBase = a.neto + a.iva + a.noGravado + a.exento;
  const caja = resto.reduce((s, f) => s + Math.abs(f.importe), 0);
  const cajaPer = percep.reduce((s, f) => s + Math.abs(f.importe), 0);
  const conRen = vivas.some((f) => f.renN > 0);
  const ren = conRen ? vivas.reduce((s, f) => s + f.renNeto + f.renIva, 0) : null;
  const okBase = cerca(caja, arcaBase);
  const okPer = cerca(cajaPer, a.otros);
  const partes = [
    { parte: "Neto + IVA", arca: arcaBase, renglones: ren, caja, ok: okBase },
    { parte: "Percepciones / otros", arca: a.otros, renglones: null, caja: cajaPer, ok: okPer },
  ];
  const textos: string[] = [];
  if (!okBase) {
    const dif = arcaBase - caja;
    if (ren != null && cerca(ren, arcaBase)) textos.push(`Los renglones coinciden con ARCA, pero en Caja se cargó ${$(Math.abs(dif))} ${dif > 0 ? "menos" : "más"} (es lo que suma en Resultados).`);
    else textos.push(`Neto + IVA: en ARCA ${$(arcaBase)}, cargado ${$(caja)} (${dif > 0 ? "faltan" : "sobran"} ${$(Math.abs(dif))}).`);
  }
  if (!okPer) {
    const dif = a.otros - cajaPer;
    textos.push(dif > 0 ? `Falta percepción por ${$(dif)}.` : `Hay ${$(-dif)} de percepción de más.`);
  }
  if (!textos.length) textos.push("Las partes coinciden: puede ser redondeo o una parte cargada en otro local.");
  const principal = resto[0];
  const igualar = !okBase && principal ? { rowId: principal.rowId, importe: Math.round((Math.abs(principal.importe) + (arcaBase - caja)) * 100) / 100 } : null;
  return { partes, texto: textos.join(" "), igualar };
}

/** En un duplicado, la que conviene anular: sin renglones ni pagos (y, si empatan, la de fecha distinta a ARCA). */
export function sugerirAnular(grupos: { comprobante: string; filas: FilaComprobante[] }[], fechaArca: string): string | null {
  if (grupos.length < 2) return null;
  const puntaje = (g: { filas: FilaComprobante[] }) =>
    (g.filas.some((f) => f.pagos > 0) ? 4 : 0) + (g.filas.some((f) => f.renN > 0) ? 2 : 0) + (g.filas.some((f) => f.fecha === fechaArca) ? 1 : 0);
  const orden = [...grupos].sort((x, y) => puntaje(x) - puntaje(y));
  return puntaje(orden[0]) < puntaje(orden[1]) ? orden[0].comprobante : null;
}
