import { Prisma } from "@prisma/client";

// Corregir con ARCA (Diego 28/10/2026): "número distinto y fecha distinta lo ajusta y fin";
// cargadas dos veces → anular la fantasma; importe distinto → qué parte no cierra y un botón
// que la corrige (Caja que no suma un renglón, percepción que falta).

/** Conceptos de caja de percepciones (MaxiRest): 133 IVA, 899 IIBB, 137 Ganancias. */
export const PERCEPCIONES = [
  { cod: "133", nombre: "Percepcion IVA" },
  { cod: "899", nombre: "IB PERCEPCION" },
  { cod: "137", nombre: "Percepcion Ganancias" },
] as const;
export const COD_PERCEPCION: string[] = PERCEPCIONES.map((p) => p.cod);

/** Una fila de compras (14) de un comprobante, con sus renglones (25) y si tiene pagos (80). */
export interface FilaComprobante {
  rowId: string; comprobante: string; localId: number; fecha: string; concepto: string | null; cod: string | null;
  importe: number; origen: string | null; renNeto: number; renIva: number; renN: number; pagos: number; anulada: boolean;
  renglones: { nombre: string; total: number }[] | null; // total con IVA de cada renglón
}

export function filasComprobantesSql(pares: { comprobante: string; localId: number }[]): Prisma.Sql {
  // En el 25, "neto" es el precio UNITARIO: el renglón es totalIns (neto) + ivaTot (+ impuestos internos).
  return Prisma.sql`
    SELECT c."rowId", c.comprobante, c."localId", to_char(COALESCE(c."fechaManual", c.fecha), 'YYYY-MM-DD') AS fecha,
           TRIM(COALESCE(cc.nombre, c.concepto)) AS concepto,
           COALESCE(c."conceptoCodigoManual", c."conceptoCodigo", c."codCga") AS cod,
           COALESCE(c."importeManual", c.importe)::float8 AS importe, c.origen,
           COALESCE(d.neto, 0)::float8 AS "renNeto", COALESCE(d.iva, 0)::float8 AS "renIva", COALESCE(d.n, 0)::int AS "renN",
           d.renglones,
           (SELECT COUNT(*) FROM pagos p WHERE p.comprobante = c.comprobante AND p."localId" = c."localId")::int AS pagos,
           EXISTS (SELECT 1 FROM compras_huerfanas h WHERE h."rowId" = c."rowId" AND h.estado = 'aplicada') AS anulada
    FROM compras c
    JOIN unnest(${pares.map((p) => p.comprobante)}::text[], ${pares.map((p) => p.localId)}::int[]) AS q(comprobante, local_id)
      ON q.comprobante = c.comprobante AND q.local_id = c."localId"
    LEFT JOIN conceptos_caja cc ON cc.codigo = COALESCE(c."conceptoCodigoManual", c."conceptoCodigo")
    LEFT JOIN LATERAL (
      SELECT SUM(COALESCE(x."totalIns", x.neto * x.cantidad, 0) + COALESCE(x."impNtTot", 0)) AS neto,
             SUM(COALESCE(x."ivaTot", 0)) AS iva, COUNT(*) AS n,
             json_agg(json_build_object('nombre', TRIM(x.nombre),
               'total', ROUND((COALESCE(x."totalIns", x.neto * x.cantidad, 0) + COALESCE(x."impNtTot", 0) + COALESCE(x."ivaTot", 0))::numeric, 2))) AS renglones
      FROM detalle_compras x WHERE x."compraId" = c."rowId") d ON true
    ORDER BY c.comprobante, COALESCE(c."importeManual", c.importe) DESC`;
}

export interface PartesArca { neto: number; iva: number; noGravado: number; exento: number; otros: number; total: number }
export interface Diagnostico {
  partes: { parte: string; arca: number; renglones: number | null; caja: number; ok: boolean }[];
  /** Una línea por problema, en castellano llano. */
  textos: string[];
  /** Caja (14) distinta de ARCA: la fila principal pasa a este importe. `por` explica el porqué (ej. el renglón que falta). */
  igualar: { rowId: string; importe: number; dif: number; por: string } | null;
  /** Percepción que falta (ARCA no dice de qué impuesto: se elige al cargarla). */
  percepcion: { importe: number; sugerida: string; cargadas: { cod: string; importe: number }[]; base: { rowId: string } } | null;
}

const $ = (n: number) => "$ " + Math.round(n).toLocaleString("es-AR");
const cerca = (a: number, b: number) => Math.abs(a - b) <= Math.max(2, Math.abs(b) * 0.01);
const nombrePer = (cod: string) => ({ "133": "IVA", "899": "IIBB", "137": "Ganancias" } as Record<string, string>)[cod] ?? cod;

/** Renglón (o par de renglones) del 25 que explica una diferencia. */
function renglonesQueFaltan(renglones: { nombre: string; total: number }[], dif: number): string[] | null {
  const tol = Math.max(2, Math.abs(dif) * 0.005);
  const uno = renglones.find((r) => Math.abs(r.total - dif) <= tol);
  if (uno) return [uno.nombre];
  for (let i = 0; i < renglones.length; i++)
    for (let j = i + 1; j < renglones.length; j++)
      if (Math.abs(renglones[i].total + renglones[j].total - dif) <= tol) return [renglones[i].nombre, renglones[j].nombre];
  return null;
}

/** Dónde está la diferencia entre ARCA y lo cargado. Lo que suma en Resultados es la Caja (14). */
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
  let igualar: Diagnostico["igualar"] = null;
  const principal = resto[0];
  if (!okBase) {
    const dif = arcaBase - caja;
    let por = dif > 0 ? `faltan ${$(dif)}` : `sobran ${$(-dif)}`;
    if (ren != null && cerca(ren, arcaBase)) {
      const falta = dif > 0 ? renglonesQueFaltan(vivas.flatMap((f) => f.renglones ?? []), dif) : null;
      por = falta ? `falta ${falta.join(" y ")} (${$(dif)})` : por;
      textos.push(`La factura está bien cargada en sus renglones (${$(ren)}, igual que ARCA), pero en Caja —que es lo que suma en Resultados— hay ${$(caja)}: ${por}.`);
    } else {
      textos.push(`Neto + IVA: ARCA dice ${$(arcaBase)} y en Caja hay ${$(caja)} (${por}).`);
    }
    if (principal) igualar = { rowId: principal.rowId, importe: Math.round((Math.abs(principal.importe) + dif) * 100) / 100, dif, por };
  }
  let percepcion: Diagnostico["percepcion"] = null;
  if (!okPer) {
    const dif = a.otros - cajaPer;
    const cargadas = percep.map((f) => ({ cod: f.cod ?? "", importe: Math.abs(f.importe) }));
    const det = cargadas.length ? ` (cargadas: ${cargadas.map((c) => `${nombrePer(c.cod)} ${$(c.importe)}`).join(" + ")})` : "";
    if (dif > 0) {
      textos.push(`Percepciones: ARCA dice ${$(a.otros)} y hay ${$(cajaPer)}${det}. Falta una de ${$(dif)}; ARCA no informa de qué impuesto es.`);
      const base = principal ?? vivas[0];
      if (base) {
        // ARCA no dice de qué impuesto es: se elige (sin sugerencia, para no adivinar).
        percepcion = { importe: Math.round(dif * 100) / 100, sugerida: "", cargadas, base: { rowId: base.rowId } };
      }
    } else {
      textos.push(`Percepciones: hay ${$(-dif)} de más${det} (ARCA dice ${$(a.otros)}).`);
    }
  }
  if (!textos.length) textos.push("Las partes coinciden: puede ser redondeo o una parte cargada en otro local.");
  return { partes, textos, igualar, percepcion };
}

/** En un duplicado, la que conviene anular: sin renglones ni pagos (y, si empatan, la de fecha distinta a ARCA). */
export function sugerirAnular(grupos: { comprobante: string; filas: FilaComprobante[] }[], fechaArca: string): string | null {
  if (grupos.length < 2) return null;
  const puntaje = (g: { filas: FilaComprobante[] }) =>
    (g.filas.some((f) => f.pagos > 0) ? 4 : 0) + (g.filas.some((f) => f.renN > 0) ? 2 : 0) + (g.filas.some((f) => f.fecha === fechaArca) ? 1 : 0);
  const orden = [...grupos].sort((x, y) => puntaje(x) - puntaje(y));
  return puntaje(orden[0]) < puntaje(orden[1]) ? orden[0].comprobante : null;
}
