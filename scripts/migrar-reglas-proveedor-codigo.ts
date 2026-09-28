import { construirEntidadIdProveedorTexto } from "../lib/proveedor-entidad-id";

export interface CodigoConteo {
  codigo: string;
  cantidadCompras: number;
  totalDistribuido: number;
}

export interface ReglaCandidata {
  id: number;
  // Formato viejo, sin sufijo de código todavía — ej. "texto:jorge".
  entidadId: string;
  destinos: { localId: number | null; puntoDeVentaId: number | null; porcentaje: number }[];
  vigencia: { modo: string; fechaDesde: Date | null; fechaHasta: Date | null; extremosInclusivos: boolean };
  origen: { origenLocalId: number | null; origenPuntoDeVentaId: number | null };
  // Códigos reales entre las compras que ESTA regla puntual ya distribuyó —
  // no un conteo a nivel de nombre. Una misma persona (nombre) puede tener
  // varias reglas con vigencias distintas (ej. "Lucas" en 3 ventanas de
  // tiempo con reparto distinto) y cada una puede tocar un subconjunto
  // distinto de códigos reales según qué compras cayeron en su ventana.
  codigos: CodigoConteo[];
}

export type DecisionRegla =
  | { tipo: "renombrar"; reglaId: number; entidadIdNuevo: string }
  | { tipo: "dividir"; reglaId: number; codigosNuevos: string[] }
  | { tipo: "omitir"; reglaId: number; razon: string };

const PREFIJO_TEXTO = "texto:";

// Pura — decide qué hacer con UNA regla en base a lo que ella misma ya
// distribuyó. 0 códigos: no hay evidencia de a cuál migrarla (nunca
// distribuyó nada, o todo lo que distribuyó quedó sin código legible) — se
// omite, no se inventa un valor. 1 código: la regla nunca mezcló dos
// personas en la práctica (aunque el nombre en general pueda tener más de
// una), renombrar alcanza. 2+: mezcla real — dividir en una regla nueva por
// código, ver docs/superpowers/specs/2026-09-28-codigo-empleado-proveedor-design.md §4.2.
export function decidirMigracionRegla(regla: ReglaCandidata): DecisionRegla {
  if (regla.codigos.length === 0) {
    return { tipo: "omitir", reglaId: regla.id, razon: "la regla no tiene compras ya distribuidas — no hay evidencia de qué código usar" };
  }
  if (regla.codigos.length === 1) {
    const normalizado = regla.entidadId.slice(PREFIJO_TEXTO.length);
    return {
      tipo: "renombrar",
      reglaId: regla.id,
      entidadIdNuevo: construirEntidadIdProveedorTexto(normalizado, regla.codigos[0].codigo),
    };
  }
  return { tipo: "dividir", reglaId: regla.id, codigosNuevos: regla.codigos.map((c) => c.codigo) };
}

export function planificarMigracionReglas(reglas: ReglaCandidata[]): DecisionRegla[] {
  return reglas.map(decidirMigracionRegla);
}

import { config } from "dotenv";
config({ path: ".env.local" });

import { fileURLToPath } from "url";
import * as path from "path";
import { prisma } from "../lib/prisma";
import { revertirRegla, aplicarRegla, type AperturaDbClient } from "../lib/apertura/motor";
import type { ReglaVigencia } from "../lib/apertura/vigencia";

const SCRATCHPAD_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "tmp", "migrar-reglas-proveedor-codigo");

interface ReglaDbRow {
  id: number;
  entidadId: string;
  modo: string;
  fechaDesde: Date | null;
  fechaHasta: Date | null;
  extremosInclusivos: boolean;
  origenLocalId: number | null;
  origenPuntoDeVentaId: number | null;
  destinos: { id: number; localId: number | null; puntoDeVentaId: number | null; porcentaje: { toString(): string } }[];
}

// Candidatas: activas, nivel proveedor, formato viejo (con "texto:", sin
// "|codigo:" todavía) — la condición NOT LIKE hace que una corrida repetida
// ignore sola las reglas que una corrida anterior ya migró (idempotente).
// IDs por SQL crudo (evita depender de si Prisma combina bien startsWith +
// not-contains en un solo filtro) y el resto de los datos vía Prisma normal.
async function buscarReglasCandidatas(): Promise<ReglaDbRow[]> {
  const ids = await prisma.$queryRawUnsafe<{ id: number }[]>(
    `SELECT id FROM reglas_apertura
     WHERE nivel = 'proveedor' AND estado = 'activa'
       AND "entidadId" LIKE 'texto:%' AND "entidadId" NOT LIKE '%|codigo:%'`
  );
  if (ids.length === 0) return [];
  return prisma.reglaApertura.findMany({
    where: { id: { in: ids.map((r) => r.id) } },
    select: {
      id: true, entidadId: true, modo: true, fechaDesde: true, fechaHasta: true, extremosInclusivos: true,
      origenLocalId: true, origenPuntoDeVentaId: true,
      destinos: { select: { id: true, localId: true, puntoDeVentaId: true, porcentaje: true } },
    },
  });
}

// Códigos reales entre las compras que cada regla YA distribuyó — join
// directo a distribuciones_apertura, no al texto crudo de la compra (que
// podría no coincidir exactamente si hubo un typo de mayúsculas en el medio,
// aunque no aplicable hoy porque el matching ya usa proveedorTextoNormalizado).
async function codigosPorRegla(reglaIds: number[]): Promise<Map<number, CodigoConteo[]>> {
  if (reglaIds.length === 0) return new Map();
  const rows = await prisma.$queryRawUnsafe<{ reglaId: number; codigo: string | null; n: bigint; total: string }[]>(
    `SELECT da."reglaId", c.codigo, COUNT(*) as n, SUM(da."importeCalculado") as total
     FROM distribuciones_apertura da
     JOIN compras c ON c."rowId" = da."compraRowId"
     WHERE da."reglaId" = ANY($1::int[]) AND c.codigo IS NOT NULL
     GROUP BY da."reglaId", c.codigo
     ORDER BY da."reglaId", c.codigo`,
    reglaIds
  );
  const out = new Map<number, CodigoConteo[]>();
  for (const row of rows) {
    const lista = out.get(row.reglaId) ?? [];
    lista.push({ codigo: row.codigo!, cantidadCompras: Number(row.n), totalDistribuido: Number(row.total) });
    out.set(row.reglaId, lista);
  }
  return out;
}

function aReglaCandidata(r: ReglaDbRow, codigos: CodigoConteo[]): ReglaCandidata {
  return {
    id: r.id,
    entidadId: r.entidadId,
    destinos: r.destinos.map((d) => ({ localId: d.localId, puntoDeVentaId: d.puntoDeVentaId, porcentaje: Number(d.porcentaje.toString()) })),
    vigencia: { modo: r.modo, fechaDesde: r.fechaDesde, fechaHasta: r.fechaHasta, extremosInclusivos: r.extremosInclusivos },
    origen: { origenLocalId: r.origenLocalId, origenPuntoDeVentaId: r.origenPuntoDeVentaId },
    codigos,
  };
}

function imprimirPlan(reglas: ReglaDbRow[], decisiones: DecisionRegla[]) {
  const porId = new Map(reglas.map((r) => [r.id, r]));
  const renombrar = decisiones.filter((d) => d.tipo === "renombrar");
  const dividir = decisiones.filter((d) => d.tipo === "dividir");
  const omitir = decisiones.filter((d) => d.tipo === "omitir");

  console.log(`\nReglas candidatas (formato viejo, activas, nivel proveedor): ${reglas.length}`);
  console.log(`  Renombrar (un solo código en sus propias distribuciones): ${renombrar.length}`);
  for (const d of renombrar) {
    if (d.tipo !== "renombrar") continue;
    console.log(`    #${d.reglaId} ${porId.get(d.reglaId)!.entidadId} -> ${d.entidadIdNuevo}`);
  }
  console.log(`  Dividir (mezclan más de una persona real): ${dividir.length}`);
  for (const d of dividir) {
    if (d.tipo !== "dividir") continue;
    console.log(`    #${d.reglaId} ${porId.get(d.reglaId)!.entidadId} -> ${d.codigosNuevos.length} reglas nuevas (códigos: ${d.codigosNuevos.join(", ")})`);
  }
  console.log(`  Omitir (sin compras ya distribuidas, sin evidencia de código): ${omitir.length}`);
  for (const d of omitir) {
    if (d.tipo !== "omitir") continue;
    console.log(`    #${d.reglaId} ${porId.get(d.reglaId)!.entidadId} — ${d.razon}`);
  }
}

async function exportarPlan(reglas: ReglaDbRow[], decisiones: DecisionRegla[], archivo: string) {
  const porId = new Map(reglas.map((r) => [r.id, r]));
  const detalle = decisiones.map((d) => ({ decision: d, entidadIdViejo: porId.get(d.reglaId)!.entidadId }));
  const fs = await import("fs");
  fs.mkdirSync(path.dirname(archivo), { recursive: true });
  fs.writeFileSync(archivo, JSON.stringify(detalle, null, 2));
  return archivo;
}

async function main() {
  const apply = process.argv.includes("--apply");

  const reglas = await buscarReglasCandidatas();
  const codigos = await codigosPorRegla(reglas.map((r) => r.id));
  const candidatas = reglas.map((r) => aReglaCandidata(r, codigos.get(r.id) ?? []));
  const decisiones = planificarMigracionReglas(candidatas);

  console.log(`\n=== Plan de migración de reglas proveedor -> nombre+código (${apply ? "aplicando" : "dry-run"}) ===`);
  imprimirPlan(reglas, decisiones);

  if (!apply) {
    const archivo = await exportarPlan(reglas, decisiones, `${SCRATCHPAD_DIR}/plan-dry-run.json`);
    console.log(`\nPlan exportado a ${archivo}`);
    console.log("\nDry-run — no se escribió nada en la base. Revisar el plan con el usuario antes de correr con --apply.\n");
    return;
  }

  console.log("\nAplicando...");

  // Recálculo en vivo — mismo criterio que fix-proveedorid-cruzado.ts: nunca
  // reusar el plan de arriba por si algo cambió la base entremedio.
  const reglasEnVivo = await buscarReglasCandidatas();
  const codigosEnVivo = await codigosPorRegla(reglasEnVivo.map((r) => r.id));
  const candidatasEnVivo = reglasEnVivo.map((r) => aReglaCandidata(r, codigosEnVivo.get(r.id) ?? []));
  const decisionesEnVivo = planificarMigracionReglas(candidatasEnVivo);

  if (decisionesEnVivo.length !== decisiones.length) {
    throw new Error(
      `Plan cambió entre el resumen mostrado y la ejecución: se esperaban ${decisiones.length} reglas candidatas, ` +
        `el recálculo en vivo encontró ${decisionesEnVivo.length}. Abortando sin escribir nada.`
    );
  }

  const porIdEnVivo = new Map(reglasEnVivo.map((r) => [r.id, r]));
  const resumen = { renombradas: 0, divididasEn: 0, omitidas: 0 };

  for (const decision of decisionesEnVivo) {
    if (decision.tipo === "omitir") {
      resumen.omitidas++;
      continue;
    }

    if (decision.tipo === "renombrar") {
      // Rename puro: no toca compras ni distribuciones_apertura (esas
      // referencian reglaId, no entidadId) — solo cambia cómo la regla
      // matchea compras FUTURAS. Bajo riesgo, sin necesidad de $transaction.
      await prisma.reglaApertura.update({
        where: { id: decision.reglaId },
        data: { entidadId: decision.entidadIdNuevo },
      });
      resumen.renombradas++;
      console.log(`  #${decision.reglaId} renombrada -> ${decision.entidadIdNuevo}`);
      continue;
    }

    // dividir: revertir + crear N reglas nuevas + redistribuir, todo en una
    // transacción — si algo falla a mitad de camino, no debe quedar la
    // regla vieja borrada sin sus reemplazos, ni reemplazos a medio crear.
    const reglaVieja = porIdEnVivo.get(decision.reglaId)!;
    const normalizado = reglaVieja.entidadId.slice("texto:".length);

    const { idsNuevasReglas, totalPreImagen } = await prisma.$transaction(async (tx: AperturaDbClient) => {
      // Pre-imagen dentro de la transacción: leerla afuera dejaba una ventana
      // en la que una edición concurrente podía correr la base de comparación
      // entre la lectura y el revert.
      const preImagen = await tx.$queryRawUnsafe<{ compraRowId: string; total: string }[]>(
        `SELECT "compraRowId", SUM("importeCalculado") as total FROM distribuciones_apertura
         WHERE "reglaId" = $1 GROUP BY "compraRowId"`,
        decision.reglaId
      );
      const totalPreImagen = preImagen.reduce((s, r) => s + Number(r.total), 0);
      const rowIdsPreImagen = new Set(preImagen.map((r) => r.compraRowId));

      await revertirRegla(tx, decision.reglaId);

      const nuevosIds: number[] = [];
      for (const codigo of decision.codigosNuevos) {
        const entidadIdNuevo = construirEntidadIdProveedorTexto(normalizado, codigo);
        const nueva = await tx.reglaApertura.create({
          data: {
            nivel: "proveedor",
            entidadId: entidadIdNuevo,
            origenLocalId: reglaVieja.origenLocalId,
            origenPuntoDeVentaId: reglaVieja.origenPuntoDeVentaId,
            modo: reglaVieja.modo,
            fechaDesde: reglaVieja.fechaDesde,
            fechaHasta: reglaVieja.fechaHasta,
            extremosInclusivos: reglaVieja.extremosInclusivos,
            estado: "activa",
            creadoPor: "migrar-reglas-proveedor-codigo.ts",
          },
        });
        const destinosNuevos = await Promise.all(
          reglaVieja.destinos.map((d) =>
            tx.destinoRegla.create({
              data: { reglaId: nueva.id, localId: d.localId, puntoDeVentaId: d.puntoDeVentaId, porcentaje: d.porcentaje.toString() },
            })
          )
        );
        await aplicarRegla(tx, {
          reglaId: nueva.id,
          nivel: "proveedor",
          entidadId: entidadIdNuevo,
          vigencia: { modo: reglaVieja.modo as ReglaVigencia["modo"], fechaDesde: reglaVieja.fechaDesde, fechaHasta: reglaVieja.fechaHasta, extremosInclusivos: reglaVieja.extremosInclusivos },
          destinos: destinosNuevos.map((d) => ({ id: d.id, porcentaje: Number(d.porcentaje.toString()) })),
          origen: { origenLocalId: reglaVieja.origenLocalId, origenPuntoDeVentaId: reglaVieja.origenPuntoDeVentaId },
        });
        nuevosIds.push(nueva.id);
      }

      await tx.destinoRegla.deleteMany({ where: { reglaId: decision.reglaId } });
      await tx.reglaApertura.delete({ where: { id: decision.reglaId } });

      // Verificación dentro de la transacción: si falla, el throw hace
      // rollback completo (revert deshecho, regla vieja intacta, nuevas nunca
      // commiteadas) en vez de dejar compras sin redistribuir. Toda compra
      // que la regla vieja tenía distribuida debe quedar cubierta por las
      // nuevas, y la plata de ESE MISMO conjunto de compras (no un total
      // global, que podría incluir compras nuevas legítimamente barridas por
      // la regla específica) debe coincidir con la pre-imagen — spec §4.2
      // "el total no debe cambiar, solo cómo se reparte".
      const postImagen = await tx.$queryRawUnsafe<{ compraRowId: string; total: string }[]>(
        `SELECT "compraRowId", SUM("importeCalculado") as total FROM distribuciones_apertura
         WHERE "reglaId" = ANY($1::int[]) AND "compraRowId" = ANY($2::text[])
         GROUP BY "compraRowId"`,
        nuevosIds,
        [...rowIdsPreImagen]
      );
      const totalPostImagen = postImagen.reduce((s, r) => s + Number(r.total), 0);
      if (postImagen.length !== rowIdsPreImagen.size) {
        throw new Error(
          `Verificación falló para regla vieja #${decision.reglaId}: ${rowIdsPreImagen.size} compras tenía distribuidas, ` +
            `${postImagen.length} quedaron cubiertas por las reglas nuevas (${nuevosIds.join(", ")}). Transacción revertida, revisar manualmente.`
        );
      }
      if (Math.abs(totalPostImagen - totalPreImagen) > 0.01) {
        throw new Error(
          `Verificación falló para regla vieja #${decision.reglaId}: total antes $${totalPreImagen}, total después $${totalPostImagen} ` +
            `sobre el mismo conjunto de compras. Transacción revertida, revisar manualmente.`
        );
      }

      return { idsNuevasReglas: nuevosIds, totalPreImagen };
    }, { timeout: 30000, maxWait: 20000 });

    resumen.divididasEn++;
    console.log(`  #${decision.reglaId} (${reglaVieja.entidadId}) dividida en ${idsNuevasReglas.length} reglas nuevas: ${idsNuevasReglas.join(", ")} — $${totalPreImagen} verificado sin cambios`);
  }

  const archivoAplicado = await exportarPlan(reglasEnVivo, decisionesEnVivo, `${SCRATCHPAD_DIR}/plan-aplicado.json`);
  console.log(`\n=== Resultado ===`);
  console.log(`Renombradas: ${resumen.renombradas}`);
  console.log(`Divididas: ${resumen.divididasEn}`);
  console.log(`Omitidas: ${resumen.omitidas}`);
  console.log(`Detalle exportado a ${archivoAplicado}`);
  console.log("\nMigración completada y verificada.\n");
}

const esEntrypointCli = process.argv[1] === fileURLToPath(import.meta.url);
if (esEntrypointCli) {
  main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => (prisma as unknown as { $disconnect: () => Promise<void> }).$disconnect());
}
