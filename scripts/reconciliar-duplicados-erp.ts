/**
 * reconciliar-duplicados-erp.ts
 *
 * Limpia las compras duplicadas por el mecanismo de edición del ERP post-carga
 * (comprobante que aparece después, OBSERVAC que se corrige — ver
 * lib/etl/normalizers/compra-identity.ts, computeCompraAnchor) — ver
 * docs/superpowers/specs/2026-09-29-reconciliacion-identidad-compras-design.md
 * para el contexto completo. Distinto del incidente de agosto
 * (scripts/cleanup-duplicados-compras.ts, causa raíz distinta: esquemas de
 * rowId divergentes entre main/dev).
 *
 * Por defecto corre en modo dry-run (solo reporta el plan, no escribe nada).
 * Requiere --apply para ejecutar el borrado contra la base real.
 *
 * Uso:
 *   npx tsx scripts/reconciliar-duplicados-erp.ts             # dry-run
 *   npx tsx scripts/reconciliar-duplicados-erp.ts --apply      # aplica de verdad
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { fileURLToPath } from "url";
import * as path from "path";
import { prisma } from "../lib/prisma";

const SCRATCHPAD_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "tmp", "reconciliar-duplicados-erp");

export interface CompraParaReconciliar {
  rowId: string;
  codCga: string | null;
  fecha: Date | null;
  codigo: string | null;
  concepto: string | null;
  importe: { toString(): string } | null;
  observac: string | null;
  esDistribuido: boolean;
  tieneDetalleCompras: boolean;
}

export interface GrupoExcluido {
  motivo: string;
  rowIds: string[];
}

export interface PlanReconciliacion {
  rowIdABorrar: string[];
  gruposExcluidos: GrupoExcluido[];
}

// Mismo ancla que computeCompraAnchor (lib/etl/normalizers/compra-identity.ts)
// — codCga+fecha+codigo+concepto+importe, sin comprobante/detalle/observac
// (los campos que el ERP edita post-carga y por eso NO sirven para agrupar
// duplicados acá).
function claveAncla(c: CompraParaReconciliar): string {
  const fechaISO = c.fecha ? c.fecha.toISOString().slice(0, 10) : "null";
  const importe = c.importe != null ? c.importe.toString() : "null";
  return [c.codCga, fechaISO, c.codigo, c.concepto, importe].join("|");
}

// Función pura, testable sin base de datos real. Nunca borra una fila con
// esDistribuido=true si la otra mitad del grupo no lo tiene también — y
// cualquier forma de grupo no verificada como segura se excluye completa en
// vez de forzarse (mismo criterio que scripts/cleanup-duplicados-compras.ts).
export function planReconciliacionDuplicados(compras: CompraParaReconciliar[]): PlanReconciliacion {
  const grupos = new Map<string, CompraParaReconciliar[]>();
  for (const c of compras) {
    const clave = claveAncla(c);
    const grupo = grupos.get(clave) ?? [];
    grupo.push(c);
    grupos.set(clave, grupo);
  }

  const rowIdABorrar: string[] = [];
  const gruposExcluidos: GrupoExcluido[] = [];

  for (const grupo of grupos.values()) {
    if (grupo.length < 2) continue;

    const rowIds = grupo.map((c) => c.rowId);
    if (grupo.length !== 2) {
      gruposExcluidos.push({ motivo: "forma inesperada (no son 2 filas)", rowIds });
      continue;
    }

    const [a, b] = grupo;
    const distribuidas = grupo.filter((c) => c.esDistribuido);

    let survivor: CompraParaReconciliar;
    let loser: CompraParaReconciliar;

    if (distribuidas.length === 1) {
      survivor = distribuidas[0];
      loser = survivor === a ? b : a;
    } else if (distribuidas.length === 0) {
      const largoA = a.observac?.length ?? 0;
      const largoB = b.observac?.length ?? 0;
      if (largoA === largoB) {
        gruposExcluidos.push({ motivo: "empate de longitud de observac, revisar a mano", rowIds });
        continue;
      }
      survivor = largoA > largoB ? a : b;
      loser = survivor === a ? b : a;
    } else {
      gruposExcluidos.push({ motivo: "ambas filas tienen esDistribuido=true, revisar a mano", rowIds });
      continue;
    }

    if (loser.tieneDetalleCompras) {
      gruposExcluidos.push({ motivo: "la fila a descartar tiene detalle_compras propio", rowIds });
      continue;
    }

    rowIdABorrar.push(loser.rowId);
  }

  return { rowIdABorrar, gruposExcluidos };
}

interface CompraDbRow {
  rowId: string;
  codCga: string | null;
  fecha: Date | null;
  codigo: string | null;
  concepto: string | null;
  importe: { toString(): string } | null;
  observac: string | null;
  esDistribuido: boolean;
  localId: number | null;
}

const SELECT_COMPRA = {
  rowId: true, codCga: true, fecha: true, codigo: true, concepto: true,
  importe: true, observac: true, esDistribuido: true, localId: true,
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
  const comprasParaReconciliar = await conDetalleCompras(prisma, compras);
  const plan = planReconciliacionDuplicados(comprasParaReconciliar);
  const porRowId = new Map(comprasParaReconciliar.map((c) => [c.rowId, c]));

  console.log(`\n=== Plan de reconciliación (${apply ? "aplicando" : "dry-run"}) ===`);
  console.log(`Compras totales: ${compras.length}`);
  console.log(`Filas a borrar: ${plan.rowIdABorrar.length}`);
  console.log(`Grupos excluidos (revisar manualmente): ${plan.gruposExcluidos.length}`);
  for (const g of plan.gruposExcluidos) {
    console.log(`  - ${g.motivo}: ${g.rowIds.join(", ")}`);
  }

  const archivoDryRun = await exportarDetalle(plan.rowIdABorrar, porRowId, `${SCRATCHPAD_DIR}/reconciliar-duplicados-dry-run.json`);
  console.log(`Detalle exportado a ${archivoDryRun}`);

  if (!apply) {
    console.log("\nDry-run — no se escribió nada en la base. Re-ejecutar con --apply para aplicar.\n");
    return;
  }

  console.log("\nAplicando...");

  // Recálculo en vivo del plan completo — nunca se reusa el plan de arriba,
  // por si algo cambió la base entre el arranque del script y este punto
  // (mismo criterio que scripts/cleanup-duplicados-compras.ts).
  const comprasEnVivo: CompraDbRow[] = await prisma.compra.findMany({ select: SELECT_COMPRA });
  const comprasParaReconciliarEnVivo = await conDetalleCompras(prisma, comprasEnVivo);
  const planEnVivo = planReconciliacionDuplicados(comprasParaReconciliarEnVivo);
  const porRowIdEnVivo = new Map(comprasParaReconciliarEnVivo.map((c) => [c.rowId, c]));

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

      const distribucionesABorrar = await tx.distribucionApertura.count({
        where: { compraRowId: { in: planEnVivo.rowIdABorrar } },
      });
      if (distribucionesABorrar > 0) {
        throw new Error(
          `No se puede proceder: ${distribucionesABorrar} distribuciones de apertura ` +
            `referencian compras candidatas a borrar. Revisar manualmente estos casos.`
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
    `${SCRATCHPAD_DIR}/reconciliar-duplicados-aplicado.json`
  );

  console.log(`\n=== Verificación post-reconciliación ===`);
  console.log(`Filas borradas: ${cantidadBorrada}`);
  console.log(`Compras: ${totalDespues} (antes ${totalAntes}, esperado ${totalAntes - cantidadBorrada})`);
  if (planEnVivo.gruposExcluidos.length > 0) {
    console.log(`Grupos excluidos en recálculo en vivo: ${planEnVivo.gruposExcluidos.length}`);
    for (const g of planEnVivo.gruposExcluidos) {
      console.log(`  - ${g.motivo}: ${g.rowIds.join(", ")}`);
    }
  }
  console.log(`Detalle de lo borrado exportado a ${archivoAplicado}`);
  console.log("\nReconciliación completada y verificada.\n");
}

const esEntrypointCli = process.argv[1] === fileURLToPath(import.meta.url);

if (esEntrypointCli) {
  main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => (prisma as unknown as { $disconnect: () => Promise<void> }).$disconnect());
}
