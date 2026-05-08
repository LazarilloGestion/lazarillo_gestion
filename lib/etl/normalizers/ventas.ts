import { createHash } from "crypto";
import type { PrismaClient } from "@prisma/client";
import { trim, toDecimal, excelDateToISO } from "../helpers";
import type { ETLRow, ETLRowError, ETLContext } from "../types";

function makeRowId(r: ETLRow): string {
  const key = [r["turno"], r["comprobant"], r["cod_cobro"], r["cobro"], r["importe"]]
    .map((v) => String(v ?? ""))
    .join("|");
  return createHash("sha256").update(key).digest("hex").substring(0, 24);
}

// Completa las cols A-F (turno→mozo) cuando una venta tiene múltiples formas de pago.
// El ERP deja esos campos vacíos en las filas secundarias; se heredan de la fila anterior.
function fillPartialRows(rows: ETLRow[]): ETLRow[] {
  const CARRY_FIELDS = ["turno", "comprobant", "hora", "tipo", "mesa", "mozo"];
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
  prisma: PrismaClient,
  ctx?: ETLContext
): Promise<{ created: number; updated: number; skipped: number; errors: ETLRowError[] }> {
  let created = 0, updated = 0;
  const errors: ETLRowError[] = [];

  const filled = fillPartialRows(rows);
  // Filtrar filas sin turno ni importe (líneas vacías o totales)
  const filtered = filled.filter((r) => r["turno"] != null && r["importe"] != null);
  const skipped = rows.length - filtered.length;

  for (let i = 0; i < filtered.length; i++) {
    const r = filtered[i];
    const rawCodigo = r["comprobant"];
    try {
      const rowId = makeRowId(r);
      const importe = toDecimal(r["importe"]);
      const data = {
        turno:       trim(r["turno"]),
        comprobant:  trim(r["comprobant"]),
        hora:        trim(r["hora"]),
        tipo:        trim(r["tipo"]),
        mesa:        trim(r["mesa"]),
        mozo:        trim(r["mozo"]),
        cub:         trim(r["cub"]),
        cobro:       trim(r["cobro"]),
        codCobro:    trim(r["cod_cobro"]),
        importe:     importe,
        importeTrabajado: importe,
        total:       toDecimal(r["total"]),
        descuento:   toDecimal(r["descuento"]),
        cliNombre:   trim(r["clinombre"]),
        cliRazon:    trim(r["clirazon"]),
        cliCut:      trim(r["clicuit"]),
        fecha:       excelDateToISO(r["fecha"]) ? new Date(excelDateToISO(r["fecha"])!) : null,
        codSuc:      trim(r["cod_suc"]),
        nombreSuc:   trim(r["nombresuc"]),
        cupon:       trim(r["cupon"]),
        localId:        ctx?.localId ?? null,
        puntoDeVentaId: ctx?.puntoDeVentaId ?? null,
      };
      const existing = await prisma.venta.findUnique({ where: { rowId }, select: { rowId: true } });
      await prisma.venta.upsert({
        where:  { rowId },
        update: data,
        create: { rowId, ...data },
      });
      if (existing) updated++; else created++;
    } catch (err) {
      errors.push({
        rowIndex: i,
        rawCodigo,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { created, updated, skipped, errors };
}
