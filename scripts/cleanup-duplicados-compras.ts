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

const esEntrypointCli = process.argv[1] === fileURLToPath(import.meta.url);

if (esEntrypointCli) {
  main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => (prisma as unknown as { $disconnect: () => Promise<void> }).$disconnect());
}

async function main() {
  // implementado en Task 2
}
