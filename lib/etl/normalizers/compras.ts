import { Prisma } from "@prisma/client";
import type { DbClient } from "../types";
import { trim, toDecimalStr, excelDateToISO } from "../helpers";
import { linkDetalleComprasByComprobante } from "../normalizer-utils";
import { compraRowSchema, type CompraRow } from "../schemas/compras";
import { formatZodError } from "../schemas/common";
import { parseComprobanteFromDetalle, computeCompraRowId, compraIdentityFromRawRow } from "./compra-identity";
import { camposErpCambiaron, type CompraErpFields } from "./compras-diff";
import { canonicalDecimal } from "./compra-identity";
import { resolveProveedorId, type ProveedorCandidato } from "./proveedor-match";

import type { ETLRow, ETLRowError, ETLContext, ETLSkippedRow } from "../types";

// Filas por chunk de INSERT ... ON CONFLICT. Con ~18 columnas: ~9k params/chunk < 65535.
const CHUNK_SIZE = 500;

function formatFechaDisplay(val: unknown): string | undefined {
  const iso = excelDateToISO(val);
  if (!iso) return undefined;
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

// Identidad partida (con/sin comprobante) delegada a compra-identity.ts — ver ese
// módulo para el porqué. Opera SIEMPRE sobre la fila cruda (ETLRow), nunca sobre
// datos ya coercionados por Zod, para que el resultado sea reproducible por el
// script de migración de rowId (que reconstruye la misma identidad desde la
// compra ya persistida, no desde el Excel original).
function makeRowId(r: ETLRow): string {
  return computeCompraRowId(compraIdentityFromRawRow(r));
}

function erpFieldsDesdeDatoParseado(data: CompraRow): CompraErpFields {
  return {
    codCga: data.COD_CGA,
    concepto: data.CONCEPTO,
    fecha: data.FECHA,
    codigo: data.CODIGO,
    proveedor: data.PROVEEDOR,
    detalle: data.DETALLE,
    observac: data.OBSERVAC,
    importe: canonicalDecimal(data.IMPORTE?.toString() ?? null),
    impInt: canonicalDecimal(data.IMP_INT?.toString() ?? null),
    imputac: data.IMPUTAC,
    per1: canonicalDecimal(data.PER1?.toString() ?? null),
    per2: canonicalDecimal(data.PER2?.toString() ?? null),
    per3: canonicalDecimal(data.PER3?.toString() ?? null),
  };
}

interface CompraExistenteRow {
  rowId: string;
  esDistribuido: boolean;
  codCga: string | null;
  concepto: string | null;
  fecha: Date | null;
  codigo: string | null;
  proveedor: string | null;
  detalle: string | null;
  observac: string | null;
  importe: { toString(): string } | null;
  impInt: { toString(): string } | null;
  imputac: string | null;
  per1: { toString(): string } | null;
  per2: { toString(): string } | null;
  per3: { toString(): string } | null;
}

function erpFieldsDesdeCompraExistente(row: CompraExistenteRow): CompraErpFields {
  return {
    codCga: row.codCga,
    concepto: row.concepto,
    fecha: row.fecha,
    codigo: row.codigo,
    proveedor: row.proveedor,
    detalle: row.detalle,
    observac: row.observac,
    importe: canonicalDecimal(row.importe != null ? row.importe.toString() : null),
    impInt: canonicalDecimal(row.impInt != null ? row.impInt.toString() : null),
    imputac: row.imputac,
    per1: canonicalDecimal(row.per1 != null ? row.per1.toString() : null),
    per2: canonicalDecimal(row.per2 != null ? row.per2.toString() : null),
    per3: canonicalDecimal(row.per3 != null ? row.per3.toString() : null),
  };
}

export async function normalizeCompras(
  rows: ETLRow[],
  prisma: DbClient,
  ctx?: ETLContext
): Promise<{
  created: number;
  updated: number;
  skipped: number;
  skippedRows: ETLSkippedRow[];
  errors: ETLRowError[];
  comprasDistribuidasModificadas: string[];
}> {
  const skippedRows: ETLSkippedRow[] = [];
  const errors: ETLRowError[] = [];

  // 1) Filtro de presencia: identificadores realmente ausentes → sin_datos.
  //    Endurecido con trim() en COD_CGA para capturar strings vacíos/whitespace,
  //    no sólo null (gap que existía en el chequeo anterior).
  // 2) Zod: fila con identificadores presentes pero algún campo (incluida FECHA
  //    corrupta, no sólo ausente) que no parsea → errors, no null en silencio.
  type ParsedRow = { rowId: string; row: ETLRow; data: CompraRow };
  const parsedRows: ParsedRow[] = [];

  rows.forEach((r, idx) => {
    if (trim(r["COD_CGA"]) == null || r["FECHA"] == null) {
      skippedRows.push({
        fecha: formatFechaDisplay(r["FECHA"]),
        concepto: trim(r["CONCEPTO"]) ?? undefined,
        importe: toDecimalStr(r["IMPORTE"]) ?? undefined,
        proveedor: trim(r["PROVEEDOR"]) ?? undefined,
        motivo: "sin_datos",
      });
      return;
    }
    const parsed = compraRowSchema.safeParse(r);
    if (!parsed.success) {
      errors.push({ rowIndex: idx, rawCodigo: r["CODIGO"], message: formatZodError(parsed.error) });
      return;
    }
    parsedRows.push({ rowId: makeRowId(r), row: r, data: parsed.data });
  });

  // Dedup por rowId — last-wins, pero ahora la fila que se pisa se reporta en
  // skippedRows con motivo "duplicado" en vez de perderse en silencio (antes
  // era exactamente el patrón que causó la pérdida del registro de $2.6M).
  const rowIdMap = new Map<string, ParsedRow>();
  for (const pr of parsedRows) {
    const prev = rowIdMap.get(pr.rowId);
    if (prev) {
      skippedRows.push({
        fecha: formatFechaDisplay(prev.row["FECHA"]),
        concepto: trim(prev.row["CONCEPTO"]) ?? undefined,
        importe: toDecimalStr(prev.row["IMPORTE"]) ?? undefined,
        proveedor: trim(prev.row["PROVEEDOR"]) ?? undefined,
        motivo: "duplicado",
      });
    }
    rowIdMap.set(pr.rowId, pr);
  }
  const filtered = Array.from(rowIdMap.values());
  const skipped = skippedRows.length;

  // Lookup tables — una sola query cada una para todo el archivo
  const codigosProv = [...new Set(filtered.map((pr) => pr.data.CODIGO).filter((v): v is string => v != null))];
  const provMap = new Map<string, ProveedorCandidato>(
    (await prisma.proveedor.findMany({
      where: { codigo: { in: codigosProv } },
      select: { id: true, codigo: true, nombre: true, razon: true },
    })).map((p) => [p.codigo, { id: p.id, nombre: p.nombre, razon: p.razon }])
  );

  const codigosConcepto = [...new Set(filtered.map((pr) => pr.data.COD_CGA).filter((v): v is string => v != null))];
  const conceptoSet = new Set(
    (await prisma.conceptoCaja.findMany({
      where: { codigo: { in: codigosConcepto } },
      select: { codigo: true },
    })).map((c) => c.codigo)
  );

  const localId = ctx?.localId ?? null;
  const puntoDeVentaId = ctx?.puntoDeVentaId ?? null;

  let created = 0;
  let updated = 0;
  const comprasDistribuidasModificadas: string[] = [];

  for (let i = 0; i < filtered.length; i += CHUNK_SIZE) {
    const chunk = filtered.slice(i, i + CHUNK_SIZE);
    const chunkRowIds = chunk.map((pr) => pr.rowId);

    const existingRows = await prisma.compra.findMany({
      where: { rowId: { in: chunkRowIds } },
      select: {
        rowId: true, esDistribuido: true,
        codCga: true, concepto: true, fecha: true, codigo: true, proveedor: true,
        detalle: true, observac: true, importe: true, impInt: true, imputac: true,
        per1: true, per2: true, per3: true,
      },
    });
    const existingMap = new Map(existingRows.map((r) => [r.rowId, r]));

    try {
      const rowValues = chunk.map(({ rowId, row, data }) => {
        const proveedorId = resolveProveedorId(data.CODIGO, data.PROVEEDOR, provMap);
        const conceptoCodigo = conceptoSet.has(data.COD_CGA) ? data.COD_CGA : null;

        return Prisma.sql`(
          ${rowId},
          ${data.COD_CGA},
          ${data.CONCEPTO},
          ${parseComprobanteFromDetalle(row["DETALLE"])},
          ${data.FECHA},
          ${data.CODIGO},
          ${data.PROVEEDOR},
          ${data.DETALLE},
          ${data.OBSERVAC},
          ${data.IMPORTE}::numeric,
          ${data.IMPORTE}::numeric,
          ${data.IMP_INT}::numeric,
          ${data.IMPUTAC},
          ${data.PER1}::numeric,
          ${data.PER2}::numeric,
          ${data.PER3}::numeric,
          ${proveedorId}::integer,
          ${conceptoCodigo},
          ${localId}::integer,
          ${puntoDeVentaId}::integer
        )`;
      });

      await prisma.$executeRaw(Prisma.sql`
        INSERT INTO compras (
          "rowId", "codCga", concepto, comprobante, fecha, codigo, proveedor, detalle, observac,
          importe, "importeTrabajado", "impInt", imputac, per1, per2, per3,
          "proveedorId", "conceptoCodigo", "localId", "puntoDeVentaId"
        )
        VALUES ${Prisma.join(rowValues)}
        ON CONFLICT ("rowId") DO UPDATE SET
          "codCga"           = EXCLUDED."codCga",
          concepto           = EXCLUDED.concepto,
          comprobante        = EXCLUDED.comprobante,
          fecha              = EXCLUDED.fecha,
          codigo             = EXCLUDED.codigo,
          proveedor          = EXCLUDED.proveedor,
          detalle            = EXCLUDED.detalle,
          observac           = EXCLUDED.observac,
          importe            = EXCLUDED.importe,
          "importeTrabajado" = EXCLUDED."importeTrabajado",
          "impInt"           = EXCLUDED."impInt",
          imputac            = EXCLUDED.imputac,
          per1               = EXCLUDED.per1,
          per2               = EXCLUDED.per2,
          per3               = EXCLUDED.per3,
          "proveedorId"      = EXCLUDED."proveedorId",
          "conceptoCodigo"   = EXCLUDED."conceptoCodigo",
          -- COALESCE: reclama filas huérfanas (localId=null) sin sobreescribir local ya asignado.
          "localId"          = COALESCE(compras."localId", EXCLUDED."localId"),
          "puntoDeVentaId"   = COALESCE(compras."puntoDeVentaId", EXCLUDED."puntoDeVentaId")
          -- importeManual, fechaManual, conceptoCodigoManual: NO se sobreescriben (overrides manuales)
      `);

      for (const { rowId, data } of chunk) {
        const oldRow = existingMap.get(rowId);
        if (oldRow) updated++; else created++;
        if (oldRow?.esDistribuido && camposErpCambiaron(erpFieldsDesdeCompraExistente(oldRow), erpFieldsDesdeDatoParseado(data))) {
          comprasDistribuidasModificadas.push(rowId);
        }
      }
    } catch (err) {
      errors.push({
        rowIndex: i,
        rawCodigo: chunk[0]?.data.CODIGO,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (ctx?.localId != null && (created > 0 || updated > 0)) {
    await linkDetalleComprasByComprobante(prisma, ctx.localId);
  }

  return { created, updated, skipped, skippedRows, errors, comprasDistribuidasModificadas };
}
