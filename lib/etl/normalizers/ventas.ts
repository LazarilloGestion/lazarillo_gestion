import { createHash } from "crypto";
import type { DbClient } from "../types";
import { trim, toDecimal, toDecimalStr, safeDate } from "../helpers";
import { processBatch } from "../normalizer-utils";
import type { ETLRow, ETLRowError, ETLContext } from "../types";

function makeRowId(r: ETLRow): string {
  // No incluir IMPORTE: si el ERP corrige el monto, el rowId debe mantenerse
  // igual para que el upsert actualice el registro existente en lugar de crear uno nuevo.
  const key = [r["TURNO"], r["COMPROBANT"], r["COD_COBRO"], r["COBRO"]]
    .map((v) => String(v ?? ""))
    .join("|");
  return createHash("sha256").update(key).digest("hex").substring(0, 24);
}

// Completa TURNO→MOZO cuando una venta tiene múltiples formas de pago.
// El ERP deja esos campos vacíos en las filas secundarias; se heredan de la fila anterior.
function fillPartialRows(rows: ETLRow[]): ETLRow[] {
  const CARRY_FIELDS = ["TURNO", "COMPROBANT", "HORA", "TIPO", "MESA", "MOZO"];
  let last: Partial<ETLRow> = {};
  return rows.map((r) => {
    const filled = { ...r };
    for (const f of CARRY_FIELDS) {
      if (filled[f] != null && filled[f] !== "") {
        last[f] = filled[f];
      } else if (last[f] != null) {
        filled[f] = last[f];
      }
    }
    return filled;
  });
}

export async function normalizeVentas(
  rows: ETLRow[],
  prisma: DbClient,
  ctx?: ETLContext
): Promise<{ created: number; updated: number; skipped: number; errors: ETLRowError[] }> {
  let created = 0, updated = 0;

  // Filtrar primero: eliminar encabezados de fecha/totales del día (TURNO Y COD_COBRO ambos nulos)
  const validRows = rows.filter((r) => !(r["TURNO"] == null && r["COD_COBRO"] == null));
  const skipped = rows.length - validRows.length;
  // Luego completar filas parciales (ventas con múltiples formas de pago)
  const filtered = fillPartialRows(validRows);

  const allRowIds = filtered.map((r) => makeRowId(r));
  const existingRowIds = new Set(
    (await prisma.venta.findMany({
      where: { rowId: { in: allRowIds } },
      select: { rowId: true },
    })).map((v) => v.rowId)
  );

  const errors = await processBatch(
    filtered,
    async (r) => {
      const rowId = makeRowId(r);
      const importe = toDecimalStr(r["IMPORTE"]);
      const data = {
        turno:       trim(r["TURNO"]),
        comprobant:  trim(r["COMPROBANT"]),
        hora:        trim(r["HORA"]),
        tipo:        trim(r["TIPO"]),
        mesa:        trim(r["MESA"]),
        mozo:        trim(r["MOZO"]),
        cub:         trim(r["CUB"]),
        cobro:       trim(r["COBRO"]),
        codCobro:    trim(r["COD_COBRO"]),
        importe:          importe,
        importeTrabajado: importe,
        total:       toDecimalStr(r["TOTAL"]),
        descuento:   toDecimalStr(r["DESCUENTO"]),
        cliNombre:   trim(r["CLINOMBRE"]),
        cliRazon:    trim(r["CLIRAZON"]),
        cliCut:      trim(r["CLICUIT"]),
        fecha:       safeDate(r["FECHA"]),
        codSuc:      trim(r["COD_SUC"]),
        nombreSuc:   trim(r["NOMBRESUC"]),
        cupon:       trim(r["CUPON"]),
        localId:        ctx?.localId ?? null,
        puntoDeVentaId: ctx?.puntoDeVentaId ?? null,
      };
      await prisma.venta.upsert({
        where:  { rowId },
        update: data,
        create: { rowId, ...data },
      });
      if (existingRowIds.has(rowId)) updated++; else created++;
    },
    (r) => r["COMPROBANT"]
  );

  return { created, updated, skipped, errors };
}
