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
import * as path from "path";
import { prisma } from "../lib/prisma";
import { computeCompraRowId, compraIdentityFromDbRecord, canonicalDecimal } from "../lib/etl/normalizers/compra-identity";

// Relativo al repo (gitignored, ver .gitignore) — antes era un path de una
// sesión efímera de Claude Code que no existe fuera de esa sandbox
// (hallazgo de code-review, 24-ago-2026). Este módulo corre como ESM bajo
// tsx (usa import.meta.url más abajo), no hay __dirname disponible.
const SCRATCHPAD_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "tmp", "cleanup-duplicados-compras");

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
// Nota: `comprobante` está en la interfaz pero se excluye deliberadamente de
// esta clave porque el esquema viejo y el nuevo pueden computarlo distinto para
// la misma transacción real; incluirlo rompería el agrupamiento de los pares.
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
  client: Pick<typeof prisma, "detalleCompra">,
  compras: T[]
): Promise<(T & { tieneDetalleCompras: boolean })[]> {
  const conteo = await client.detalleCompra.groupBy({
    by: ["compraId"],
    where: { compraId: { not: null } },
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
  fs.mkdirSync(path.dirname(archivo), { recursive: true });
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

  // Recálculo en vivo del plan completo — nunca se reusa el plan de arriba,
  // por si algo cambió la base entre el arranque del script y este punto.
  // Se hace ACÁ, fuera de cualquier $transaction, para no mantener abierto
  // un full table scan de compras + detalle_compras bajo una transacción de
  // hasta 120s — eso arriesgaba lock contention contra lecturas/escrituras
  // concurrentes del dashboard en producción (hallazgo de eficiencia,
  // code-review 24-ago-2026). La transacción de abajo solo vuelve a
  // re-verificar las filas candidatas puntuales justo antes de borrar, para
  // cerrar el hueco de tiempo entre este recálculo y el borrado real.
  const comprasEnVivo: CompraDbRow[] = await prisma.compra.findMany({ select: SELECT_COMPRA });
  const comprasParaLimpiezaEnVivo = await conDetalleCompras(prisma, comprasEnVivo);
  const planEnVivo = planCleanupDuplicados(comprasParaLimpiezaEnVivo);
  const porRowIdEnVivo = new Map(comprasParaLimpiezaEnVivo.map((c) => [c.rowId, c]));

  // Si el plan en vivo difiere del que se mostró al usuario, abortar
  if (planEnVivo.rowIdABorrar.length !== plan.rowIdABorrar.length) {
    throw new Error(
      `Plan cambió entre el resumen mostrado y la ejecución: ` +
        `se esperaba borrar ${plan.rowIdABorrar.length} filas, ` +
        `pero el recálculo en vivo encontró ${planEnVivo.rowIdABorrar.length}`
    );
  }

  if (planEnVivo.rowIdABorrar.length === 0) {
    console.log("\nNo hay nada para borrar — no se declara éxito de limpieza.\n");
    return;
  }

  const { cantidadBorrada, totalAntes, totalDespues } = await prisma.$transaction(
    async (tx) => {
      // Re-verificación puntual (solo las filas candidatas, no la tabla
      // entera) justo antes de borrar — cierra el hueco de tiempo entre el
      // recálculo en vivo de arriba y este DELETE.
      const candidatasAhora = await tx.compra.findMany({
        where: { rowId: { in: planEnVivo.rowIdABorrar } },
        select: { rowId: true, esDistribuido: true },
      });
      if (candidatasAhora.length !== planEnVivo.rowIdABorrar.length) {
        throw new Error(
          `Verificación falló: ${planEnVivo.rowIdABorrar.length} filas candidatas esperadas, ` +
            `${candidatasAhora.length} encontradas justo antes de borrar — alguna desapareció entremedio.`
        );
      }
      const yaDistribuida = candidatasAhora.find((c) => c.esDistribuido);
      if (yaDistribuida) {
        throw new Error(
          `Verificación falló: ${yaDistribuida.rowId} pasó a esDistribuido=true entre el recálculo y el borrado.`
        );
      }

      // Chequear cascadas: no hay que borrar nada que tenga distribucionApertura asociada
      const distribucionesABorrar = await tx.distribucionApertura.count({
        where: { compraRowId: { in: planEnVivo.rowIdABorrar } },
      });
      if (distribucionesABorrar > 0) {
        throw new Error(
          `No se puede proceder: ${distribucionesABorrar} distribuciones de apertura ` +
            `referencia compras candidatas a borrar. Revisar manualmente estos casos.`
        );
      }

      const totalAntes = await tx.compra.count();

      const resultado = await tx.compra.deleteMany({ where: { rowId: { in: planEnVivo.rowIdABorrar } } });
      if (resultado.count !== planEnVivo.rowIdABorrar.length) {
        throw new Error(
          `Verificación falló: se esperaba borrar ${planEnVivo.rowIdABorrar.length} filas, se borraron ${resultado.count}`
        );
      }

      const totalDespues = await tx.compra.count();
      if (totalDespues !== totalAntes - resultado.count) {
        throw new Error(
          `Verificación falló: conteo post-borrado inconsistente ` +
            `(antes ${totalAntes}, después ${totalDespues}, esperado ${totalAntes - resultado.count})`
        );
      }

      return { cantidadBorrada: resultado.count, totalAntes, totalDespues };
    },
    { timeout: 30000, maxWait: 20000 }
  );

  const archivoAplicado = await exportarDetalle(
    planEnVivo.rowIdABorrar,
    porRowIdEnVivo,
    `${SCRATCHPAD_DIR}/cleanup-duplicados-aplicado.json`
  );

  console.log(`\n=== Verificación post-limpieza ===`);
  console.log(`Filas borradas: ${cantidadBorrada}`);
  console.log(`Compras: ${totalDespues} (antes ${totalAntes}, esperado ${totalAntes - cantidadBorrada})`);
  if (planEnVivo.gruposExcluidos.length > 0) {
    console.log(`Grupos excluidos en recálculo en vivo: ${planEnVivo.gruposExcluidos.length}`);
    for (const g of planEnVivo.gruposExcluidos) {
      console.log(`  - ${g.motivo}: ${g.rowIds.join(", ")}`);
    }
  }
  console.log(`Detalle de lo borrado exportado a ${archivoAplicado}`);
  console.log("\nLimpieza completada y verificada.\n");
}

const esEntrypointCli = process.argv[1] === fileURLToPath(import.meta.url);

if (esEntrypointCli) {
  main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => (prisma as unknown as { $disconnect: () => Promise<void> }).$disconnect());
}
