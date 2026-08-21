/**
 * cleanup-duplicados-compras.ts
 *
 * Borra las compras duplicadas por el mecanismo de rowId divergente entre
 * main (esquema viejo) y dev (esquema nuevo, ver
 * lib/etl/normalizers/compra-identity.ts) — ver
 * docs/superpowers/specs/2026-08-21-limpieza-duplicados-compras-design.md
 * para el contexto completo. La causa raíz ya está cortada (main promovida
 * a dev) — este script limpia las filas que quedaron duplicadas mientras
 * estuvo activa.
 *
 * Por defecto corre en modo dry-run (solo reporta el plan, no escribe nada).
 * Requiere --apply para ejecutar el borrado contra la base real.
 *
 * Uso:
 *   npx tsx scripts/cleanup-duplicados-compras.ts             # dry-run
 *   npx tsx scripts/cleanup-duplicados-compras.ts --apply      # aplica de verdad
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { fileURLToPath } from "url";
import { prisma } from "../lib/prisma";
import { computeCompraRowId, compraIdentityFromDbRecord, canonicalDecimal } from "../lib/etl/normalizers/compra-identity";

const SCRATCHPAD_DIR = "/private/tmp/claude-501/-Users-imanolalvarez-Documents-lazarillo-gestion/40e2565b-fdcf-460c-9387-ff8d7f319ad4/scratchpad";

export interface CompraParaLimpieza {
  rowId: string;
  codCga: string | null;
  fecha: Date | null;
  codigo: string | null;
  concepto: string | null;
  comprobante: string | null;
  detalle: string | null;
  observac: string | null;
  importe: { toString(): string } | null;
  esDistribuido: boolean;
  tieneDetalleCompras: boolean;
}

export interface PlanLimpieza {
  rowIdABorrar: string[];
  gruposExcluidos: { motivo: string; rowIds: string[] }[];
}

// Mismos campos descriptivos que usó la investigación original para agrupar
// duplicados — dos compras son "la misma transacción real" si coinciden acá.
function claveGrupo(c: CompraParaLimpieza): string {
  return [
    c.codCga,
    c.fecha ? c.fecha.toISOString().slice(0, 10) : null,
    c.codigo,
    c.concepto,
    c.detalle,
    c.observac,
    canonicalDecimal(c.importe != null ? c.importe.toString() : null),
  ]
    .map((v) => v ?? "")
    .join("|");
}

function esquemaCoincide(c: CompraParaLimpieza): boolean {
  return computeCompraRowId(compraIdentityFromDbRecord(c)) === c.rowId;
}

// Función pura, testable sin base de datos real — separa "qué hay que
// borrar" de "cómo se aplica el borrado". Un grupo con cualquier forma de
// riesgo se excluye completo, nunca se fuerza el borrado de un caso no
// verificado como seguro.
export function planCleanupDuplicados(compras: CompraParaLimpieza[]): PlanLimpieza {
  const grupos = new Map<string, CompraParaLimpieza[]>();
  for (const c of compras) {
    const key = claveGrupo(c);
    const grupo = grupos.get(key) ?? [];
    grupo.push(c);
    grupos.set(key, grupo);
  }

  const rowIdABorrar: string[] = [];
  const gruposExcluidos: { motivo: string; rowIds: string[] }[] = [];

  for (const grupo of grupos.values()) {
    if (grupo.length < 2) continue; // sin duplicado, nada que hacer

    const rowIds = grupo.map((c) => c.rowId);
    const coincidenEsquemaNuevo = grupo.filter(esquemaCoincide);
    const candidatasABorrar = grupo.filter((c) => !esquemaCoincide(c));

    if (grupo.length !== 2 || coincidenEsquemaNuevo.length !== 1 || candidatasABorrar.length !== 1) {
      gruposExcluidos.push({ motivo: "forma inesperada (no es 1 vieja + 1 nueva)", rowIds });
      continue;
    }

    const candidata = candidatasABorrar[0];
    if (candidata.esDistribuido) {
      gruposExcluidos.push({ motivo: "la fila candidata a borrar tiene esDistribuido=true", rowIds });
      continue;
    }
    if (candidata.tieneDetalleCompras) {
      gruposExcluidos.push({ motivo: "la fila candidata a borrar tiene detalle_compras propio", rowIds });
      continue;
    }

    rowIdABorrar.push(candidata.rowId);
  }

  return { rowIdABorrar, gruposExcluidos };
}

interface CompraDbRow {
  rowId: string;
  codCga: string | null;
  fecha: Date | null;
  codigo: string | null;
  concepto: string | null;
  comprobante: string | null;
  detalle: string | null;
  observac: string | null;
  importe: { toString(): string } | null;
  esDistribuido: boolean;
  localId: number | null;
}

const SELECT_COMPRA = {
  rowId: true, codCga: true, fecha: true, codigo: true, concepto: true,
  comprobante: true, detalle: true, observac: true, importe: true,
  esDistribuido: true, localId: true,
} as const;

async function conDetalleCompras<T extends { rowId: string }>(
  client: typeof prisma,
  compras: T[]
): Promise<(T & { tieneDetalleCompras: boolean })[]> {
  const conteo = await client.detalleCompra.groupBy({
    by: ["compraId"],
    where: { compraId: { in: compras.map((c) => c.rowId) } },
    _count: true,
  });
  const rowIdsConDetalle = new Set(
    conteo.map((d) => d.compraId).filter((id): id is string => id !== null)
  );
  return compras.map((c) => ({ ...c, tieneDetalleCompras: rowIdsConDetalle.has(c.rowId) }));
}

async function exportarDetalle(rowIdABorrar: string[], porRowId: Map<string, CompraDbRow>, archivo: string) {
  const detalle = rowIdABorrar.map((rowId) => {
    const c = porRowId.get(rowId)!;
    return {
      rowId: c.rowId,
      importe: c.importe != null ? c.importe.toString() : null,
      fecha: c.fecha,
      localId: c.localId,
    };
  });
  const fs = await import("fs");
  fs.writeFileSync(archivo, JSON.stringify(detalle, null, 2));
  return archivo;
}

async function main() {
  const apply = process.argv.includes("--apply");

  const compras: CompraDbRow[] = await prisma.compra.findMany({ select: SELECT_COMPRA });
  const comprasParaLimpieza = await conDetalleCompras(prisma, compras);
  const plan = planCleanupDuplicados(comprasParaLimpieza);
  const porRowId = new Map(comprasParaLimpieza.map((c) => [c.rowId, c]));

  console.log(`\n=== Plan de limpieza (${apply ? "aplicando" : "dry-run"}) ===`);
  console.log(`Compras totales: ${compras.length}`);
  console.log(`Filas a borrar: ${plan.rowIdABorrar.length}`);
  console.log(`Grupos excluidos (revisar manualmente): ${plan.gruposExcluidos.length}`);
  for (const g of plan.gruposExcluidos) {
    console.log(`  - ${g.motivo}: ${g.rowIds.join(", ")}`);
  }
  const importeLiberado = plan.rowIdABorrar.reduce((acc, rowId) => {
    const c = porRowId.get(rowId);
    return acc + (c?.importe ? Number(c.importe.toString()) : 0);
  }, 0);
  console.log(`Importe total que se liberaría: ${importeLiberado.toFixed(2)}`);

  const archivoDryRun = await exportarDetalle(plan.rowIdABorrar, porRowId, `${SCRATCHPAD_DIR}/cleanup-duplicados-dry-run.json`);
  console.log(`Detalle exportado a ${archivoDryRun}`);

  if (!apply) {
    console.log("\nDry-run — no se escribió nada en la base. Re-ejecutar con --apply para aplicar.\n");
    return;
  }

  console.log("\nAplicando...");
  const totalAntes = await prisma.compra.count();

  const { cantidadBorrada, porRowIdEnVivo, rowIdABorrarEnVivo } = await prisma.$transaction(async (tx) => {
    // Recálculo en vivo — nunca se reusa el plan de arriba, por si algo
    // cambió la base entre el arranque del script y este punto.
    const comprasEnVivo: CompraDbRow[] = await tx.compra.findMany({ select: SELECT_COMPRA });
    const comprasParaLimpiezaEnVivo = await conDetalleCompras(tx as unknown as typeof prisma, comprasEnVivo);
    const planEnVivo = planCleanupDuplicados(comprasParaLimpiezaEnVivo);

    const resultado = await tx.compra.deleteMany({ where: { rowId: { in: planEnVivo.rowIdABorrar } } });
    if (resultado.count !== planEnVivo.rowIdABorrar.length) {
      throw new Error(
        `Verificación falló: se esperaba borrar ${planEnVivo.rowIdABorrar.length} filas, se borraron ${resultado.count}`
      );
    }

    return {
      cantidadBorrada: resultado.count,
      porRowIdEnVivo: new Map(comprasParaLimpiezaEnVivo.map((c) => [c.rowId, c])),
      rowIdABorrarEnVivo: planEnVivo.rowIdABorrar,
    };
  });

  const archivoAplicado = await exportarDetalle(
    rowIdABorrarEnVivo,
    porRowIdEnVivo,
    `${SCRATCHPAD_DIR}/cleanup-duplicados-aplicado.json`
  );

  const totalDespues = await prisma.compra.count();
  console.log(`\n=== Verificación post-limpieza ===`);
  console.log(`Filas borradas: ${cantidadBorrada}`);
  console.log(`Compras: ${totalDespues} (antes ${totalAntes}, esperado ${totalAntes - cantidadBorrada})`);
  console.log(`Detalle de lo borrado exportado a ${archivoAplicado}`);

  if (totalDespues !== totalAntes - cantidadBorrada) {
    console.error("\n⚠ VERIFICACIÓN FALLÓ — revisar antes de continuar con cualquier otro paso.\n");
    process.exit(1);
  }

  console.log("\nLimpieza completada y verificada.\n");
}

const esEntrypointCli = process.argv[1] === fileURLToPath(import.meta.url);

if (esEntrypointCli) {
  main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => (prisma as unknown as { $disconnect: () => Promise<void> }).$disconnect());
}
