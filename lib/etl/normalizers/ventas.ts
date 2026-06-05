import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import type { DbClient } from "../types";
import { trim, toDecimalStr, safeDate } from "../helpers";
import type { ETLRow, ETLRowError, ETLContext } from "../types";

// Filas por chunk de INSERT ... ON CONFLICT. Con ~23 columnas: ~11.5k params/chunk < 65535.
const CHUNK_SIZE = 500;

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
  // Filtrar primero: eliminar encabezados de fecha/totales del día (TURNO Y COD_COBRO ambos nulos)
  const validRows = rows.filter((r) => !(r["TURNO"] == null && r["COD_COBRO"] == null));
  // Completar filas parciales, luego deduplicar por rowId — last wins
  const filtered = Array.from(
    fillPartialRows(validRows)
      .reduce((m, r) => m.set(makeRowId(r), r), new Map<string, ETLRow>())
      .values()
  );
  // skipped = filas inválidas + duplicados dentro del archivo
  const skipped = rows.length - filtered.length;

  const localId = ctx?.localId ?? null;
  const puntoDeVentaId = ctx?.puntoDeVentaId ?? null;

  let created = 0;
  let updated = 0;
  const errors: ETLRowError[] = [];

  for (let i = 0; i < filtered.length; i += CHUNK_SIZE) {
    const chunk = filtered.slice(i, i + CHUNK_SIZE);

    // Precompute rowIds para contar created vs updated
    const chunkRowIds = chunk.map(makeRowId);
    const existingSet = new Set(
      (await prisma.venta.findMany({
        where: { rowId: { in: chunkRowIds } },
        select: { rowId: true },
      })).map((v) => v.rowId)
    );

    try {
      const rowValues = chunk.map((r) => {
        const rowId = makeRowId(r);
        const importe = toDecimalStr(r["IMPORTE"]);
        return Prisma.sql`(
          ${rowId},
          ${trim(r["TURNO"])},
          ${trim(r["COMPROBANT"])},
          ${trim(r["HORA"])},
          ${trim(r["TIPO"])},
          ${trim(r["MESA"])},
          ${trim(r["MOZO"])},
          ${trim(r["CUB"])},
          ${trim(r["COBRO"])},
          ${trim(r["COD_COBRO"])},
          ${importe}::numeric,
          ${importe}::numeric,
          ${toDecimalStr(r["TOTAL"])}::numeric,
          ${toDecimalStr(r["DESCUENTO"])}::numeric,
          ${trim(r["CLINOMBRE"])},
          ${trim(r["CLIRAZON"])},
          ${trim(r["CLICUIT"])},
          ${safeDate(r["FECHA"])},
          ${trim(r["COD_SUC"])},
          ${trim(r["NOMBRESUC"])},
          ${trim(r["CUPON"])},
          ${localId}::integer,
          ${puntoDeVentaId}::integer
        )`;
      });

      await (prisma as unknown as { $executeRaw: (q: Prisma.Sql) => Promise<number> }).$executeRaw(Prisma.sql`
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
          "localId"         = EXCLUDED."localId",
          "puntoDeVentaId"  = EXCLUDED."puntoDeVentaId"
      `);

      for (const rowId of chunkRowIds) {
        if (existingSet.has(rowId)) updated++; else created++;
      }
    } catch (err) {
      errors.push({
        rowIndex: i,
        rawCodigo: `chunk[${i}..${i + chunk.length - 1}] — primero: ${chunk[0]?.["COMPROBANT"]}`,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { created, updated, skipped, errors };
}
