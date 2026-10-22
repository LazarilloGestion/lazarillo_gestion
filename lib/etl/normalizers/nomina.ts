import { Prisma } from "@prisma/client";
import type { DbClient, ETLContext, ETLRow, ETLRowError, ETLSkippedRow } from "../types";
import { excelDateToISO, filaCruda, trim } from "../helpers";
import { insertChunkWithRowFallback } from "../chunked-upsert";

// "000 - nomina" del kit: un archivo por PDV con los empleados de MaxiRest
// (columnas en minúscula: pdv, codigo, nombre, apellido, fecha_baja…). Va en la
// carpeta de transaccionales del PDV, igual que el 14: el PDV sale de ahí.

export interface FilaNomina { codigo: string; nombre: string | null; apellido: string | null; fechaBaja: string | null }

function col(r: ETLRow, nombre: string): unknown {
  for (const k of Object.keys(r)) if (k.trim().toUpperCase() === nombre) return r[k];
  return undefined;
}

// "2025-10-31 0:00:00", "2025-10-31" o serial de Excel → "2025-10-31".
export function fechaNomina(v: unknown): string | null {
  if (typeof v === "number") return excelDateToISO(v);
  const s = trim(v);
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m || Number(m[1]) < 1900) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

export function filaNomina(r: ETLRow): FilaNomina | null {
  const codigo = trim(col(r, "CODIGO"));
  if (!codigo) return null;
  return {
    codigo,
    nombre: trim(col(r, "NOMBRE")),
    apellido: trim(col(r, "APELLIDO")),
    fechaBaja: fechaNomina(col(r, "FECHA_BAJA")),
  };
}

export async function normalizeNomina(
  rows: ETLRow[],
  prisma: DbClient,
  ctx?: ETLContext
): Promise<{ created: number; updated: number; skipped: number; skippedRows: ETLSkippedRow[]; errors: ETLRowError[] }> {
  const pdv = ctx?.puntoDeVentaId;
  if (!pdv) {
    return {
      created: 0, updated: 0, skipped: 0, skippedRows: [],
      errors: [{ rowIndex: 0, rawCodigo: null, message: "La nómina va en la carpeta de transaccionales de un PDV (no se sabe de qué PDV es)." }],
    };
  }
  const skippedRows: ETLSkippedRow[] = [];
  const filas: { idx: number; row: ETLRow; f: FilaNomina }[] = [];
  const vistos = new Set<string>();
  rows.forEach((row, idx) => {
    const f = filaNomina(row);
    if (!f) { skippedRows.push({ motivo: "sin_datos", ...filaCruda(row, idx) }); return; }
    if (vistos.has(f.codigo)) { skippedRows.push({ motivo: "duplicado", proveedor: f.codigo, ...filaCruda(row, idx) }); return; }
    vistos.add(f.codigo);
    filas.push({ idx, row, f });
  });

  const existentes = new Set(
    (await prisma.empleado.findMany({ where: { puntoDeVentaId: pdv }, select: { codigo: true } })).map((e) => e.codigo)
  );
  let created = 0;
  let updated = 0;
  const errors: ETLRowError[] = [];
  for (let i = 0; i < filas.length; i += 500) {
    const chunk = filas.slice(i, i + 500);
    errors.push(...await insertChunkWithRowFallback(
      prisma,
      chunk,
      (rs) => Prisma.sql`
        INSERT INTO empleados ("puntoDeVentaId", codigo, nombre, apellido, "fechaBaja", "actualizadoEn")
        VALUES ${Prisma.join(rs.map(({ f }) => Prisma.sql`(${pdv}::integer, ${f.codigo}, ${f.nombre}, ${f.apellido}, ${f.fechaBaja}::date, NOW())`))}
        ON CONFLICT ("puntoDeVentaId", codigo) DO UPDATE SET
          nombre = EXCLUDED.nombre, apellido = EXCLUDED.apellido,
          "fechaBaja" = EXCLUDED."fechaBaja", "actualizadoEn" = NOW()
      `,
      ({ idx, row, f }, err) => ({ rowIndex: idx, rawCodigo: f.codigo, message: err instanceof Error ? err.message : String(err), ...filaCruda(row, idx) }),
      (ok) => { for (const { f } of ok) { if (existentes.has(f.codigo)) updated++; else created++; } }
    ));
  }
  return { created, updated, skipped: skippedRows.length, skippedRows, errors };
}
