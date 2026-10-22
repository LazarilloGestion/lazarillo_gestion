import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import type { DbClient } from "../types";
import { trim, toDecimalStr, excelDateToISO, filaCruda } from "../helpers";
import type { ETLRow, ETLRowError, ETLContext, ETLSkippedRow } from "../types";
import { ventaRowSchema, type VentaRow } from "../schemas/ventas";
import { formatZodError } from "../schemas/common";
import { insertChunkWithRowFallback } from "../chunked-upsert";

// Filas por chunk de INSERT ... ON CONFLICT.
// 500 → 2000 (22/10/2026): el 22 de Comercio 2025 trae 40.886 filas y con
// lotes de 500 son ~164 idas y vueltas a la base (findMany + upsert por lote);
// con la latencia Vercel↔Supabase cortaba a los 60 s con 38.000 cargadas.
// 23 parámetros por fila × 2000 = 46.000, debajo del tope de 65.535 de Postgres.
const CHUNK_SIZE = 2000;

// makeRowId opera sobre la fila ya "rellenada" por fillPartialRows (igual que el
// comportamiento original) pero nunca sobre datos coercionados por Zod — el hash
// tiene que ser estable entre reimports del mismo archivo.
function makeRowId(r: ETLRow): string {
  // FECHA incluida para evitar colisiones entre transacciones sin TURNO/COMPROBANT
  // (ventas de cancha sin turno asignado): distintos días con mismo COBRO/IMPORTE
  // colisionaban y se perdían. Secondary rows (FECHA=null) pueden colidir entre sí,
  // pero el dashboard los excluye con WHERE fecha IS NOT NULL.
  const key = [r["TURNO"], r["COMPROBANT"], r["COD_COBRO"], r["COBRO"], r["IMPORTE"], r["CUPON"], r["FECHA"]]
    .map((v) => String(v ?? ""))
    .join("|");
  return createHash("sha256").update(key).digest("hex").substring(0, 24);
}

// Completa TURNO→NOMBRESUC cuando una venta tiene múltiples formas de pago (pago partido).
// El ERP deja esos campos vacíos en las filas secundarias; se heredan de la fila anterior.
// Soporta N formas de cobro consecutivas (el cliente puede pagar con 4, 5 o 6 métodos).
function fillPartialRows(rows: ETLRow[]): ETLRow[] {
  const CARRY_FIELDS = ["TURNO", "COMPROBANT", "HORA", "TIPO", "MESA", "MOZO", "COD_SUC", "NOMBRESUC"];
  const last: Partial<ETLRow> = {};
  return rows.map((r) => {
    const filled = { ...r };
    for (const f of CARRY_FIELDS) {
      const v = filled[f];
      const empty = v == null || String(v).trim() === "";
      if (!empty) {
        last[f] = v;
      } else if (last[f] != null) {
        filled[f] = last[f];
      }
    }
    return filled;
  });
}

function formatFecha(val: unknown): string | undefined {
  const iso = excelDateToISO(val);
  if (!iso) return undefined;
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export async function normalizeVentas(
  rows: ETLRow[],
  prisma: DbClient,
  ctx?: ETLContext
): Promise<{ created: number; updated: number; skipped: number; skippedRows: ETLSkippedRow[]; errors: ETLRowError[] }> {
  // Filtrar primero: eliminar encabezados de fecha/totales del día (TURNO y COD_COBRO ambos vacíos)
  const indiceEnArchivo = new Map(rows.map((r, i) => [r, i] as const));
  const invalidRows = rows.filter((r) => trim(r["TURNO"]) == null && trim(r["COD_COBRO"]) == null);
  const validRows = rows.filter((r) => !(trim(r["TURNO"]) == null && trim(r["COD_COBRO"]) == null));
  const filled = fillPartialRows(validRows);

  const skippedRows: ETLSkippedRow[] = invalidRows.map((r): ETLSkippedRow => ({
    fecha: formatFecha(r["FECHA"]),
    concepto: trim(r["COBRO"]) ?? undefined,
    importe: toDecimalStr(r["IMPORTE"]) ?? toDecimalStr(r["TOTAL"]) ?? undefined,
    motivo: "sin_datos",
    ...filaCruda(r, indiceEnArchivo.get(r) ?? 0),
  }));
  const errors: ETLRowError[] = [];

  // Fila con TURNO/COD_COBRO presentes pero algún otro campo (ej. IMPORTE con
  // contenido no numérico) que no parsea → errors, no null en silencio.
  type ParsedRow = { rowId: string; row: ETLRow; data: VentaRow; idx: number };
  const parsedRows: ParsedRow[] = [];
  filled.forEach((r, idx) => {
    const parsed = ventaRowSchema.safeParse(r);
    if (!parsed.success) {
      errors.push({ rowIndex: idx, rawCodigo: r["COMPROBANT"], message: formatZodError(parsed.error), ...filaCruda(r, idx) });
      return;
    }
    parsedRows.push({ rowId: makeRowId(r), row: r, data: parsed.data, idx });
  });

  // Dedup por rowId — last-wins, pero ahora la fila que se pisa se reporta en
  // skippedRows con motivo "duplicado" en vez de perderse en silencio.
  const rowIdMap = new Map<string, ParsedRow>();
  for (const pr of parsedRows) {
    const prev = rowIdMap.get(pr.rowId);
    if (prev) {
      skippedRows.push({
        fecha: formatFecha(prev.row["FECHA"]),
        concepto: trim(prev.row["COBRO"]) ?? undefined,
        importe: toDecimalStr(prev.row["IMPORTE"]) ?? toDecimalStr(prev.row["TOTAL"]) ?? undefined,
        motivo: "duplicado",
        ...filaCruda(prev.row, prev.idx),
        original: filaCruda(pr.row, pr.idx),
      });
    }
    rowIdMap.set(pr.rowId, pr);
  }
  const filtered = Array.from(rowIdMap.values());
  const skipped = skippedRows.length;

  const localId = ctx?.localId ?? null;
  const puntoDeVentaId = ctx?.puntoDeVentaId ?? null;

  let created = 0;
  let updated = 0;

  for (let i = 0; i < filtered.length; i += CHUNK_SIZE) {
    const chunk = filtered.slice(i, i + CHUNK_SIZE);
    const chunkRowIds = chunk.map((pr) => pr.rowId);

    const existingSet = new Set(
      (await prisma.venta.findMany({
        where: { rowId: { in: chunkRowIds } },
        select: { rowId: true },
      })).map((v) => v.rowId)
    );

    const chunkErrors = await insertChunkWithRowFallback(
      prisma,
      chunk,
      (rowsToInsert) => {
        const rowValues = rowsToInsert.map(({ rowId, data }) => {
          return Prisma.sql`(
            ${rowId},
            ${data.TURNO},
            ${data.COMPROBANT},
            ${data.HORA},
            ${data.TIPO},
            ${data.MESA},
            ${data.MOZO},
            ${data.CUB},
            ${data.COBRO},
            ${data.COD_COBRO},
            ${data.IMPORTE}::numeric,
            ${data.IMPORTE}::numeric,
            ${data.TOTAL}::numeric,
            ${data.DESCUENTO}::numeric,
            ${data.CLINOMBRE},
            ${data.CLIRAZON},
            ${data.CLICUIT},
            ${data.FECHA},
            ${data.COD_SUC},
            ${data.NOMBRESUC},
            ${data.CUPON},
            ${localId}::integer,
            ${puntoDeVentaId}::integer
          )`;
        });

        return Prisma.sql`
          INSERT INTO ventas (
            "rowId", turno, comprobant, hora, tipo, mesa, mozo, cub, cobro, "codCobro",
            importe, "importeTrabajado", total, descuento, "cliNombre", "cliRazon", "cliCut",
            fecha, "codSuc", "nombreSuc", cupon, "localId", "puntoDeVentaId"
          )
          VALUES ${Prisma.join(rowValues)}
          ON CONFLICT ("rowId") DO UPDATE SET
            turno             = EXCLUDED.turno,
            comprobant        = EXCLUDED.comprobant,
            hora              = EXCLUDED.hora,
            tipo              = EXCLUDED.tipo,
            mesa              = EXCLUDED.mesa,
            mozo              = EXCLUDED.mozo,
            cub               = EXCLUDED.cub,
            cobro             = EXCLUDED.cobro,
            "codCobro"        = EXCLUDED."codCobro",
            importe           = EXCLUDED.importe,
            -- importeTrabajado: NO se sobreescribe (override manual, igual que compras)
            total             = EXCLUDED.total,
            descuento         = EXCLUDED.descuento,
            "cliNombre"       = EXCLUDED."cliNombre",
            "cliRazon"        = EXCLUDED."cliRazon",
            "cliCut"          = EXCLUDED."cliCut",
            fecha             = EXCLUDED.fecha,
            "codSuc"          = EXCLUDED."codSuc",
            "nombreSuc"       = EXCLUDED."nombreSuc",
            cupon             = EXCLUDED.cupon,
            -- COALESCE: reclama filas huérfanas (localId=null) sin sobreescribir local ya asignado.
            "localId"         = COALESCE(ventas."localId", EXCLUDED."localId"),
            "puntoDeVentaId"  = COALESCE(ventas."puntoDeVentaId", EXCLUDED."puntoDeVentaId")
        `;
      },
      ({ idx, row, data }, err) => ({
        rowIndex: idx,
        rawCodigo: data.COMPROBANT,
        message: err instanceof Error ? err.message : String(err),
        ...filaCruda(row, idx),
      }),
      (insertedRows) => {
        for (const { rowId } of insertedRows) {
          if (existingSet.has(rowId)) updated++; else created++;
        }
      }
    );
    errors.push(...chunkErrors);
  }

  return { created, updated, skipped, skippedRows, errors };
}
