/**
 * limpiar-distribuciones-duplicadas.ts
 *
 * Borra las copias sobrantes de distribuciones_apertura que dejaron corridas
 * concurrentes del motor de apertura (28-sep y 3-oct-2026): una compra repartida
 * por una regla quedó con las filas de cada destino repetidas 2 o 3 veces, y el
 * dashboard la muestra con el importe x2/x3. La causa (corridas sin lock) ya está
 * cortada por tomarLockDeAplicacion (lib/apertura/motor.ts) — este script limpia
 * lo que quedó.
 *
 * Por cada (compra, destino, regla) conserva la fila de menor id y borra las
 * demás. Una compra con cualquier forma inesperada se EXCLUYE completa y se
 * reporta para revisión manual — nunca se fuerza el borrado de un caso no
 * verificado como seguro.
 *
 * Dry-run por defecto (solo reporta y exporta un respaldo de lo que borraría).
 * Requiere --apply para borrar contra la base real. Con --apply recalcula el
 * plan en vivo, aborta si difiere del mostrado, y verifica dentro de la misma
 * transacción que no queden duplicados y que cada compra cierre contra su
 * importe original; si algo no cierra, hace rollback.
 *
 * Uso:
 *   npx tsx scripts/limpiar-distribuciones-duplicadas.ts            # dry-run
 *   npx tsx scripts/limpiar-distribuciones-duplicadas.ts --apply     # aplica
 */

import { fileURLToPath } from "url";
import * as path from "path";
import { config } from "dotenv";
config({ path: ".env.local" });

import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { tomarLockDeAplicacion } from "../lib/apertura/motor";

// Relativo al repo (gitignored: /tmp/ en .gitignore) — mismo criterio que
// cleanup-duplicados-compras.ts. Corre como ESM bajo tsx, no hay __dirname.
const RESPALDO_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "tmp", "limpiar-distribuciones-duplicadas");

// Tolerancia de redondeo del reparto: calcularDistribuciones asigna el resto a un
// destino, así que la suma cierra al centavo; 5 centavos deja margen sin dejar
// pasar una compra cuyo importe realmente cambió.
const TOLERANCIA_CENTAVOS = 5;

export interface FilaDistribucion {
  id: number;
  compraRowId: string;
  reglaId: number;
  destinoId: number;
  importeOriginal: string;
  porcentaje: string;
  importeCalculado: string;
}

export interface PlanLimpiezaDistribuciones {
  idsABorrar: number[];
  comprasALimpiar: number;
  comprasExcluidas: { compraRowId: string; motivo: string }[];
  importeLiberado: number;
}

const aCentavos = (importe: string): number => Math.round(Number(importe) * 100);

// Función pura (testeable sin base): separa "qué hay que borrar" de "cómo se
// aplica". Solo evalúa compras que tienen algún (destino, regla) repetido — una
// compra sana no se toca ni se juzga.
export function planLimpiezaDistribuciones(filas: FilaDistribucion[]): PlanLimpiezaDistribuciones {
  const porCompra = new Map<string, FilaDistribucion[]>();
  for (const f of filas) {
    const grupo = porCompra.get(f.compraRowId) ?? [];
    grupo.push(f);
    porCompra.set(f.compraRowId, grupo);
  }

  const idsABorrar: number[] = [];
  const comprasExcluidas: { compraRowId: string; motivo: string }[] = [];
  let comprasALimpiar = 0;
  let centavosLiberados = 0;

  for (const [compraRowId, filasCompra] of porCompra) {
    const porDestinoRegla = new Map<string, FilaDistribucion[]>();
    for (const f of filasCompra) {
      const clave = `${f.reglaId}|${f.destinoId}`;
      const grupo = porDestinoRegla.get(clave) ?? [];
      grupo.push(f);
      porDestinoRegla.set(clave, grupo);
    }
    const grupos = [...porDestinoRegla.values()];
    if (!grupos.some((g) => g.length > 1)) continue;

    const excluir = (motivo: string) => comprasExcluidas.push({ compraRowId, motivo });

    if (new Set(filasCompra.map((f) => f.reglaId)).size > 1) {
      excluir("repartida por más de una regla");
      continue;
    }
    if (new Set(grupos.map((g) => g.length)).size > 1) {
      excluir("copias desparejas entre destinos");
      continue;
    }
    const copiasIguales = grupos.every((g) =>
      g.every(
        (f) =>
          aCentavos(f.importeCalculado) === aCentavos(g[0].importeCalculado) &&
          aCentavos(f.importeOriginal) === aCentavos(g[0].importeOriginal) &&
          aCentavos(f.porcentaje) === aCentavos(g[0].porcentaje)
      )
    );
    if (!copiasIguales) {
      excluir("copias con importes distintos entre sí");
      continue;
    }

    const conservadas = grupos.map((g) => g.reduce((min, f) => (f.id < min.id ? f : min)));
    const sumaConservada = conservadas.reduce((acc, f) => acc + aCentavos(f.importeCalculado), 0);
    if (Math.abs(sumaConservada - aCentavos(conservadas[0].importeOriginal)) > TOLERANCIA_CENTAVOS) {
      excluir("la suma de lo conservado no cierra con el importe original");
      continue;
    }

    const idsConservados = new Set(conservadas.map((f) => f.id));
    for (const f of filasCompra) {
      if (idsConservados.has(f.id)) continue;
      idsABorrar.push(f.id);
      centavosLiberados += aCentavos(f.importeCalculado);
    }
    comprasALimpiar++;
  }

  return { idsABorrar, comprasALimpiar, comprasExcluidas, importeLiberado: centavosLiberados / 100 };
}

interface FilaDistribucionDb {
  id: number;
  compraRowId: string;
  reglaId: number;
  destinoId: number;
  importeOriginal: Prisma.Decimal;
  porcentaje: Prisma.Decimal;
  importeCalculado: Prisma.Decimal;
  procesadoEn: Date;
}

type Cliente = Pick<typeof prisma, "$queryRaw">;

// Trae TODAS las filas de las compras que tienen algún (compra, destino, regla)
// repetido — no solo las repetidas — para que el plan vea la compra completa
// (otras reglas, copias desparejas).
async function leerFilasDeComprasConDuplicados(cliente: Cliente, soloCompras?: string[]): Promise<FilaDistribucionDb[]> {
  const filtro =
    soloCompras != null
      ? Prisma.sql`"compraRowId" = ANY(${soloCompras}::text[])`
      : Prisma.sql`"compraRowId" IN (
          SELECT "compraRowId" FROM distribuciones_apertura
          GROUP BY "compraRowId", "destinoId", "reglaId" HAVING count(*) > 1
        )`;
  return cliente.$queryRaw<FilaDistribucionDb[]>(Prisma.sql`
    SELECT id, "compraRowId", "reglaId", "destinoId", "importeOriginal", porcentaje, "importeCalculado", "procesadoEn"
    FROM distribuciones_apertura
    WHERE ${filtro}
    ORDER BY "compraRowId", id
  `);
}

const aFilaPlan = (f: FilaDistribucionDb): FilaDistribucion => ({
  id: f.id,
  compraRowId: f.compraRowId,
  reglaId: f.reglaId,
  destinoId: f.destinoId,
  importeOriginal: f.importeOriginal.toString(),
  porcentaje: f.porcentaje.toString(),
  importeCalculado: f.importeCalculado.toString(),
});

async function exportarRespaldo(filas: FilaDistribucionDb[], ids: number[], archivo: string): Promise<string> {
  const aBorrar = new Set(ids);
  const fs = await import("fs");
  fs.mkdirSync(path.dirname(archivo), { recursive: true });
  // Fila completa (con procesadoEn) para poder restaurar tal cual si hiciera falta.
  fs.writeFileSync(archivo, JSON.stringify(filas.filter((f) => aBorrar.has(f.id)), null, 2));
  return archivo;
}

function imprimirResumen(plan: PlanLimpiezaDistribuciones, modo: string): void {
  console.log(`\n=== Plan de limpieza de distribuciones duplicadas (${modo}) ===`);
  console.log(`Compras a limpiar: ${plan.comprasALimpiar}`);
  console.log(`Filas a borrar: ${plan.idsABorrar.length}`);
  console.log(`Importe inflado que se libera: ${plan.importeLiberado.toFixed(2)}`);
  console.log(`Compras excluidas (revisar a mano): ${plan.comprasExcluidas.length}`);
  for (const e of plan.comprasExcluidas) console.log(`  - ${e.compraRowId}: ${e.motivo}`);
}

const mismosIds = (a: number[], b: number[]): boolean => {
  if (a.length !== b.length) return false;
  const orden = (x: number[]) => [...x].sort((m, n) => m - n);
  const [oa, ob] = [orden(a), orden(b)];
  return oa.every((id, i) => id === ob[i]);
};

async function main() {
  const apply = process.argv.includes("--apply");
  const sello = new Date().toISOString().replace(/[:.]/g, "-");

  const filas = await leerFilasDeComprasConDuplicados(prisma);
  const plan = planLimpiezaDistribuciones(filas.map(aFilaPlan));
  imprimirResumen(plan, apply ? "aplicando" : "dry-run");

  const respaldo = await exportarRespaldo(filas, plan.idsABorrar, path.join(RESPALDO_DIR, `${apply ? "apply" : "dry-run"}-${sello}.json`));
  console.log(`Respaldo de las filas a borrar: ${respaldo}`);

  if (!apply) {
    console.log("\nDry-run — no se escribió nada. Volvé a correr con --apply para borrar.\n");
    return;
  }
  if (plan.idsABorrar.length === 0) {
    console.log("\nNada para borrar.\n");
    return;
  }

  // Compras involucradas: la verificación posterior mira solo esas.
  const comprasAfectadas = [...new Set(filas.filter((f) => plan.idsABorrar.includes(f.id)).map((f) => f.compraRowId))];

  const borradas = await prisma.$transaction(
    async (tx) => {
      // Mismo lock que usa el motor: ningún import ni edición puede estar
      // redistribuyendo estas compras mientras se borra.
      await tomarLockDeAplicacion(tx);

      // Recalculo EN VIVO dentro de la transacción — nunca se confía en el plan
      // mostrado arriba, la base pudo cambiar entremedio.
      const filasVivas = await leerFilasDeComprasConDuplicados(tx, comprasAfectadas);
      const planVivo = planLimpiezaDistribuciones(filasVivas.map(aFilaPlan));
      if (!mismosIds(planVivo.idsABorrar, plan.idsABorrar)) {
        throw new Error(
          `El plan cambió entre el resumen y la ejecución: se esperaban ${plan.idsABorrar.length} filas, ` +
            `el recálculo en vivo encontró ${planVivo.idsABorrar.length}. No se borró nada.`
        );
      }

      const n = await tx.$executeRaw(Prisma.sql`DELETE FROM distribuciones_apertura WHERE id = ANY(${plan.idsABorrar}::int[])`);
      if (n !== plan.idsABorrar.length) {
        throw new Error(`Se borraron ${n} filas pero el plan esperaba ${plan.idsABorrar.length}. Rollback.`);
      }

      // Verificación post-borrado, dentro de la misma transacción: si no cierra,
      // el throw revierte todo.
      const despues = await leerFilasDeComprasConDuplicados(tx, comprasAfectadas);
      const planDespues = planLimpiezaDistribuciones(despues.map(aFilaPlan));
      if (planDespues.idsABorrar.length > 0 || planDespues.comprasExcluidas.length > 0) {
        throw new Error("Post-borrado: todavía quedan duplicados o compras en forma inesperada. Rollback.");
      }
      const descuadradas = await tx.$queryRaw<{ n: number }[]>(Prisma.sql`
        SELECT count(*)::int AS n FROM (
          SELECT "compraRowId", SUM("importeCalculado") AS suma, MAX("importeOriginal") AS base
          FROM distribuciones_apertura WHERE "compraRowId" = ANY(${comprasAfectadas}::text[])
          GROUP BY "compraRowId"
        ) x WHERE abs(suma - base) > ${TOLERANCIA_CENTAVOS / 100}
      `);
      if (descuadradas[0].n > 0) {
        throw new Error(`Post-borrado: ${descuadradas[0].n} compras no cierran contra su importe original. Rollback.`);
      }
      return n;
    },
    { timeout: 55000 }
  );

  console.log(`\nBorradas ${borradas} filas de ${comprasAfectadas.length} compras. Verificado dentro de la transacción: sin duplicados y cada compra cierra contra su importe original.\n`);
}

const esEntrypointCli = process.argv[1] === fileURLToPath(import.meta.url);

if (esEntrypointCli) {
  main()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
