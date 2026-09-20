/**
 * fix-proveedorid-cruzado.ts
 *
 * Corrige compras cuyo proveedorId quedó linkeado a un proveedor incorrecto por
 * colisión de código (ver docs/superpowers/specs/2026-09-19-cruce-proveedorid-compras-design.md).
 * El ETL ya corta la causa para futuros imports (lib/etl/normalizers/compras.ts) —
 * este script corrige las filas que ya quedaron mal linkeadas en producción.
 * Al nulificar proveedorId también completa proveedorTextoNormalizado, para que
 * la fila siga siendo matcheable por una regla de Apertura de texto crudo.
 *
 * Por defecto corre en modo dry-run (solo reporta el plan, no escribe nada).
 * Requiere --apply para ejecutar contra la base real.
 *
 * Uso:
 *   npx tsx scripts/fix-proveedorid-cruzado.ts                              # dry-run
 *   npx tsx scripts/fix-proveedorid-cruzado.ts --apply                      # aplica de verdad
 *   npx tsx scripts/fix-proveedorid-cruzado.ts --apply --esperadas=2164     # aplica solo si el
 *     recálculo en vivo encuentra exactamente 2164 filas — pin contra el número que un humano
 *     aprobó en la corrida de dry-run anterior (proceso separado, ver Task 5).
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { fileURLToPath } from "url";
import * as path from "path";
import { prisma } from "../lib/prisma";
import { proveedorTextoCoincide } from "../lib/etl/normalizers/proveedor-match";
import { normalizarProveedorTexto } from "../lib/text-normalize";

// Relativo al repo (gitignored, ver .gitignore) — mismo criterio que
// cleanup-duplicados-compras.ts: este módulo corre como ESM bajo tsx (usa
// import.meta.url más abajo), no hay __dirname disponible.
const SCRATCHPAD_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "tmp", "fix-proveedorid-cruzado");

export interface CompraParaFix {
  rowId: string;
  proveedor: string | null;
  proveedorNombre: string | null;
  proveedorRazon: string | null;
}

export interface PlanFixProveedor {
  rowIdANulificar: string[];
}

// Función pura, testable sin base de datos real — separa "qué hay que
// corregir" de "cómo se aplica la corrección" (mismo criterio que
// planCleanupDuplicados en cleanup-duplicados-compras.ts). Reusa
// proveedorTextoCoincide (lib/etl/normalizers/proveedor-match.ts) en vez de
// reimplementar el criterio de matching — es la misma regla que ya corta la
// causa raíz para los imports nuevos.
export function planFixProveedorCruzado(compras: CompraParaFix[]): PlanFixProveedor {
  const rowIdANulificar = compras
    .filter((c) => !proveedorTextoCoincide(c.proveedor, { nombre: c.proveedorNombre, razon: c.proveedorRazon }))
    .map((c) => c.rowId);
  return { rowIdANulificar };
}

interface CompraDbRow {
  rowId: string;
  proveedor: string | null;
  proveedorId: number | null;
  importe: { toString(): string } | null;
  fecha: Date | null;
  proveedorRef: { nombre: string | null; razon: string | null } | null;
}

const SELECT_COMPRA = {
  rowId: true,
  proveedor: true,
  proveedorId: true,
  importe: true,
  fecha: true,
  proveedorRef: { select: { nombre: true, razon: true } },
} as const;

function aCompraParaFix(c: CompraDbRow): CompraParaFix {
  return {
    rowId: c.rowId,
    proveedor: c.proveedor,
    proveedorNombre: c.proveedorRef?.nombre ?? null,
    proveedorRazon: c.proveedorRef?.razon ?? null,
  };
}

// Se registra el proveedorId anterior (I3, code review) — sin esto, deshacer
// una corrección ya aplicada requeriría restaurar el dump completo de la base
// en vez de un script quirúrgico puntual sobre estas filas.
async function exportarDetalle(rowIds: string[], porRowId: Map<string, CompraDbRow>, archivo: string) {
  const detalle = rowIds.map((rowId) => {
    const c = porRowId.get(rowId)!;
    return {
      rowId: c.rowId,
      proveedorTextoCrudo: c.proveedor,
      proveedorIdAnterior: c.proveedorId,
      proveedorNombreActual: c.proveedorRef?.nombre ?? null,
      importe: c.importe != null ? c.importe.toString() : null,
      fecha: c.fecha,
    };
  });
  const fs = await import("fs");
  fs.mkdirSync(path.dirname(archivo), { recursive: true });
  fs.writeFileSync(archivo, JSON.stringify(detalle, null, 2));
  return archivo;
}

// Desglose por rubro de las filas candidatas — pedido explícito del spec de
// diseño (2026-09-19-cruce-proveedorid-compras-design.md) que se había perdido
// al traducir la spec a texto de tarea (I5, code review). Reusa la relación
// Compra.conceptoCaja ya existente (basada en conceptoCodigo, que es codCga
// validado contra el maestro de conceptos en el ETL — ver
// lib/etl/normalizers/compras.ts) en vez de re-implementar el join manual
// sobre el texto crudo de codCga: mismo resultado, sin duplicar lógica de
// validación de FK que el ETL ya resuelve.
async function desglosePorRubro(rowIds: string[]): Promise<{ rubro: string; cantidad: number }[]> {
  if (rowIds.length === 0) return [];
  const filas = await prisma.compra.findMany({
    where: { rowId: { in: rowIds } },
    select: { conceptoCaja: { select: { rubro: { select: { nombre: true } } } } },
  });
  const conteoPorRubro = new Map<string, number>();
  for (const f of filas) {
    const rubro = f.conceptoCaja?.rubro?.nombre ?? "Sin rubro";
    conteoPorRubro.set(rubro, (conteoPorRubro.get(rubro) ?? 0) + 1);
  }
  return [...conteoPorRubro.entries()]
    .map(([rubro, cantidad]) => ({ rubro, cantidad }))
    .sort((a, b) => b.cantidad - a.cantidad);
}

// Una compra con esDistribuido=true tiene plata real ya repartida en
// distribuciones_apertura por una regla de Apertura de Gastos (lib/apertura/motor.ts
// setea el flag y las filas en la misma transacción, así que el flag es fiel).
// Si esa regla es de nivel proveedor, nulificar proveedorId deja viva una
// distribución cuya premisa ya no existe, sin que nadie se entere. Mismo
// criterio que cleanup-duplicados-compras.ts aplica antes de borrar: se corta
// duro y lo mira un humano — sin flag de bypass.
async function contarCandidatasDistribuidas(rowIds: string[]): Promise<number> {
  if (rowIds.length === 0) return 0;
  return prisma.compra.count({ where: { rowId: { in: rowIds }, esDistribuido: true } });
}

function imprimirDesglosePorRubro(desglose: { rubro: string; cantidad: number }[]) {
  if (desglose.length === 0) return;
  console.log("Desglose por rubro de las filas a corregir:");
  for (const { rubro, cantidad } of desglose) {
    console.log(`  - ${rubro}: ${cantidad}`);
  }
}

// --esperadas=<N> pin del número que el humano aprobó en la corrida de
// dry-run anterior (proceso separado, ver Task 5) contra el recálculo en vivo
// de esta corrida de --apply — sin esto, un import que corre entremedio de
// las dos invocaciones podría hacer que --apply corrija una cantidad de filas
// distinta a la que el humano efectivamente revisó, sin que nada lo detecte
// (I4, code review).
function parsearEsperadas(argv: string[]): number | null {
  const arg = argv.find((a) => a.startsWith("--esperadas="));
  if (!arg) return null;
  const valor = Number(arg.slice("--esperadas=".length));
  if (!Number.isInteger(valor) || valor < 0) {
    throw new Error(`--esperadas debe ser un entero no negativo, se recibió "${arg}"`);
  }
  return valor;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const esperadas = parsearEsperadas(process.argv);

  const compras: CompraDbRow[] = await prisma.compra.findMany({
    where: { proveedorId: { not: null } },
    select: SELECT_COMPRA,
  });
  const plan = planFixProveedorCruzado(compras.map(aCompraParaFix));
  const porRowId = new Map(compras.map((c) => [c.rowId, c]));

  console.log(`\n=== Plan de corrección de proveedorId cruzado (${apply ? "aplicando" : "dry-run"}) ===`);
  console.log(`Compras con proveedorId asignado: ${compras.length}`);
  console.log(`Filas a poner en null (cruzadas): ${plan.rowIdANulificar.length}`);
  // Se reporta también en dry-run (no solo como guard de --apply) para que el
  // humano que revisa los números antes del backup vea el problema y pueda
  // decidir qué hacer, en vez de descubrirlo cuando --apply aborte.
  const distribuidas = await contarCandidatasDistribuidas(plan.rowIdANulificar);
  console.log(`Candidatas con distribución activa (esDistribuido=true): ${distribuidas}`);
  if (distribuidas > 0) {
    console.log(
      "  ⚠ Cualquier valor distinto de 0 acá es condición de parada: --apply va a abortar. " +
        "Requiere revisión manual de esas filas antes de seguir."
    );
  }
  imprimirDesglosePorRubro(await desglosePorRubro(plan.rowIdANulificar));

  if (!apply) {
    // Este archivo es el artefacto de auditoría que el humano revisa antes de
    // aprobar --apply (ver Task 5) — solo se escribe en modo dry-run. La
    // corrida de --apply NUNCA lo pisa (I4, code review): si lo hiciera,
    // destruiría la evidencia exacta que se aprobó, antes incluso de escribir
    // nada en la base.
    const archivoDryRun = await exportarDetalle(plan.rowIdANulificar, porRowId, `${SCRATCHPAD_DIR}/fix-proveedorid-dry-run.json`);
    console.log(`Detalle exportado a ${archivoDryRun}`);
    console.log("\nDry-run — no se escribió nada en la base. Re-ejecutar con --apply para aplicar.\n");
    return;
  }

  console.log("\nAplicando...");

  // Recálculo en vivo — nunca se reusa el plan de arriba, por si algo cambió
  // la base entre el arranque del script y este punto (mismo criterio que
  // cleanup-duplicados-compras.ts).
  const comprasEnVivo: CompraDbRow[] = await prisma.compra.findMany({
    where: { proveedorId: { not: null } },
    select: SELECT_COMPRA,
  });
  const planEnVivo = planFixProveedorCruzado(comprasEnVivo.map(aCompraParaFix));
  const porRowIdEnVivo = new Map(comprasEnVivo.map((c) => [c.rowId, c]));

  if (planEnVivo.rowIdANulificar.length !== plan.rowIdANulificar.length) {
    throw new Error(
      `Plan cambió entre el resumen mostrado y la ejecución: ` +
        `se esperaba corregir ${plan.rowIdANulificar.length} filas, ` +
        `pero el recálculo en vivo encontró ${planEnVivo.rowIdANulificar.length}`
    );
  }

  // Ancla contra la corrida de dry-run aprobada en una invocación anterior y
  // separada del proceso (I4, code review) — la comparación de arriba solo
  // detecta drift DENTRO de esta misma invocación de --apply, no drift entre
  // el dry-run que el humano vio y esta corrida.
  if (esperadas !== null && planEnVivo.rowIdANulificar.length !== esperadas) {
    throw new Error(
      `--esperadas=${esperadas} no coincide con el recálculo en vivo: ` +
        `se encontraron ${planEnVivo.rowIdANulificar.length} filas a corregir. ` +
        `La base pudo haber cambiado desde el dry-run aprobado — abortando sin escribir nada.`
    );
  }

  if (planEnVivo.rowIdANulificar.length === 0) {
    console.log("\nNo hay nada para corregir.\n");
    return;
  }

  // Guard duro contra el conjunto RECALCULADO EN VIVO (no el del dry-run):
  // ninguna fila a nulificar puede tener una distribución de apertura activa.
  // Aborta antes de abrir la transacción, sin escribir nada y sin bypass.
  const distribuidasEnVivo = await contarCandidatasDistribuidas(planEnVivo.rowIdANulificar);
  if (distribuidasEnVivo > 0) {
    throw new Error(
      `No se puede proceder: ${distribuidasEnVivo} de las ${planEnVivo.rowIdANulificar.length} filas candidatas ` +
        `tienen esDistribuido=true (distribuciones de apertura activas sobre plata real). ` +
        `Nulificar su proveedorId dejaría esas distribuciones huérfanas de la regla de nivel proveedor que las generó. ` +
        `Abortando sin escribir nada — revisar manualmente esas filas antes de reintentar.`
    );
  }

  // Red de seguridad ante caída del proceso: la pre-imagen (rowId →
  // proveedorIdAnterior) se escribe ANTES de abrir la transacción. El export
  // post-commit sigue siendo el registro autoritativo de lo que efectivamente
  // pasó; este archivo existe solo para que un crash entre el commit y ese
  // export no deje como única salida restaurar el pg_dump completo.
  const archivoPreApply = await exportarDetalle(
    planEnVivo.rowIdANulificar,
    porRowIdEnVivo,
    `${SCRATCHPAD_DIR}/fix-proveedorid-pre-apply.json`
  );
  console.log(`Pre-imagen para deshacer exportada a ${archivoPreApply}`);

  const { cantidadActualizada } = await prisma.$transaction(
    async (tx) => {
      // Re-verificación puntual del predicado real (no solo existencia de
      // fila) justo antes de escribir — si alguna candidata fue re-linkeada a
      // un proveedor correcto entremedio del recálculo en vivo y este punto,
      // ya no debe nulificarse. Mismo criterio que cleanup-duplicados-compras.ts
      // re-verifica esDistribuido antes de borrar, no solo que la fila siga
      // existiendo (I1, code review).
      const candidatasAhora = await tx.compra.findMany({
        where: { rowId: { in: planEnVivo.rowIdANulificar }, proveedorId: { not: null } },
        select: { rowId: true, proveedor: true, proveedorRef: { select: { nombre: true, razon: true } } },
      });
      if (candidatasAhora.length !== planEnVivo.rowIdANulificar.length) {
        throw new Error(
          `Verificación falló: ${planEnVivo.rowIdANulificar.length} filas candidatas esperadas, ` +
            `${candidatasAhora.length} encontradas justo antes de aplicar — alguna cambió entremedio.`
        );
      }
      const yaCoincide = candidatasAhora.find((c) =>
        proveedorTextoCoincide(c.proveedor, { nombre: c.proveedorRef?.nombre ?? null, razon: c.proveedorRef?.razon ?? null })
      );
      if (yaCoincide) {
        throw new Error(
          `Verificación falló: ${yaCoincide.rowId} fue re-linkeada a un proveedor que ahora sí coincide ` +
            `con su texto crudo, entre el recálculo en vivo y la corrección — ya no debe nulificarse.`
        );
      }

      // Nulificar proveedorId sin poblar proveedorTextoNormalizado dejaría estas
      // filas invisibles para el motor de Apertura: el árbol del dashboard las
      // agrupa por c.proveedor crudo, así que el usuario las vería bajo su nodo
      // de texto, pero una regla de texto activa sobre ese nodo nunca las
      // matchearía (condicionMatchNivel exige proveedorTextoNormalizado = valor)
      // — plata aperturada en pantalla que el motor nunca distribuye, sin error.
      // Cada fila tiene su propio texto crudo, así que se agrupa por valor
      // normalizado y se emite un updateMany por grupo (mismo patrón que
      // backfill-proveedor-texto-normalizado.ts) en vez de uno solo masivo.
      const porTextoNormalizado = new Map<string, string[]>();
      for (const rowId of planEnVivo.rowIdANulificar) {
        const textoNormalizado = normalizarProveedorTexto(porRowIdEnVivo.get(rowId)!.proveedor);
        const rowIds = porTextoNormalizado.get(textoNormalizado) ?? [];
        rowIds.push(rowId);
        porTextoNormalizado.set(textoNormalizado, rowIds);
      }

      // proveedorId: { not: null } en el where hace que este count sea una
      // aserción real (antes matcheaba solo por PK, que ya estaba garantizado
      // por el filtro de arriba — I2, code review).
      let cantidad = 0;
      for (const [proveedorTextoNormalizado, rowIds] of porTextoNormalizado) {
        const resultado = await tx.compra.updateMany({
          where: { rowId: { in: rowIds }, proveedorId: { not: null } },
          data: { proveedorId: null, proveedorTextoNormalizado },
        });
        cantidad += resultado.count;
      }
      if (cantidad !== planEnVivo.rowIdANulificar.length) {
        throw new Error(
          `Verificación falló: se esperaba corregir ${planEnVivo.rowIdANulificar.length} filas, se actualizaron ${cantidad}`
        );
      }

      // Verificación posterior real: ninguna de las filas candidatas debe
      // seguir con proveedorId no-nulo después del update (I2, code review).
      const remanentes = await tx.compra.count({
        where: { rowId: { in: planEnVivo.rowIdANulificar }, proveedorId: { not: null } },
      });
      if (remanentes !== 0) {
        throw new Error(
          `Verificación falló: ${remanentes} filas candidatas siguen con proveedorId no-nulo después de la corrección.`
        );
      }

      return { cantidadActualizada: cantidad };
    },
    // Con el agrupamiento por texto crudo, la transacción pasó de 1 statement a
    // uno por valor distinto de proveedor entre las candidatas (centenares
    // posibles) — 30s dejaba de tener margen. Mismo criterio que
    // backfill-proveedor-texto-normalizado.ts.
    { timeout: 120000, maxWait: 20000 }
  );

  const archivoAplicado = await exportarDetalle(
    planEnVivo.rowIdANulificar,
    porRowIdEnVivo,
    `${SCRATCHPAD_DIR}/fix-proveedorid-aplicado.json`
  );

  console.log(`\n=== Verificación post-corrección ===`);
  console.log(`Filas corregidas (proveedorId → null): ${cantidadActualizada}`);
  imprimirDesglosePorRubro(await desglosePorRubro(planEnVivo.rowIdANulificar));
  console.log(`Detalle de lo corregido exportado a ${archivoAplicado}`);
  console.log("\nCorrección completada y verificada.\n");
}

const esEntrypointCli = process.argv[1] === fileURLToPath(import.meta.url);

if (esEntrypointCli) {
  main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => (prisma as unknown as { $disconnect: () => Promise<void> }).$disconnect());
}
