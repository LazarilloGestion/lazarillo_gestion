# Migración de reglas de Apertura — nombre+código Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate every active `ReglaApertura` at nivel "proveedor" whose `entidadId` is still in the old `texto:<nombre>` format (no `|codigo:` suffix) to the new nombre+código format — renaming in place where the rule only ever distributed one real person's compras, or splitting into one new rule per real person (reverting and redistributing its history) where it mixed several.

**Architecture:** One script, following the exact dry-run/backup/confirm/apply/verify shape already established by `scripts/fix-proveedorid-cruzado.ts` in this codebase. A pure planning function decides, per rule, whether it's a simple rename or needs a split — driven entirely by what that rule ACTUALLY distributed (queried live), not by a hardcoded list of rule ids. This makes the script self-verifying and safe to re-run (already-migrated rules are naturally excluded from the candidate query, since their `entidadId` already has the `|codigo:` suffix).

**Tech Stack:** `tsx` script, Prisma raw queries (`$queryRawUnsafe`/`Prisma.sql`), reuses `lib/proveedor-entidad-id.ts` (`construirEntidadIdProveedorTexto`) and `lib/apertura/motor.ts` (`revertirRegla`, `aplicarRegla`) — both already in `main`.

**Spec:** `docs/superpowers/specs/2026-09-28-codigo-empleado-proveedor-design.md` §4 (design), and this plan's own investigation below (exact real data, gathered 2026-09-28 against the live database — re-verify counts at execution time, since compras keep importing).

## Global Constraints

- Default to dry-run; `--apply` is required to write anything — same convention as `scripts/fix-proveedorid-cruzado.ts`.
- **The actual `--apply` run against the real database is a separate checkpoint that requires the user's explicit confirmation AFTER seeing the dry-run output — never run `--apply` automatically as part of executing this plan, regardless of execution mode.** Task 2's last step is the dry-run; Task 3 is the `--apply` step, and it is gated on that confirmation, not on task ordering alone.
- A rule migrates only if `nivel = 'proveedor'`, `estado = 'activa'`, `entidadId` starts with `texto:` and does NOT already contain `|codigo:` (idempotent: a partial or re-run naturally skips already-migrated rules).
- Whether a rule is a simple rename or needs a split is decided from what THAT rule's own `distribuciones_apertura` actually contain (joined to `Compra.codigo`) — never from a name-wide code count across all compras (a name can have codes that were never actually claimed by this particular rule, e.g. because they fall outside its vigencia/origen).
- Every new rule created for a split copies the old rule's `destinos` (same local/PDV/porcentaje), `vigencia` (modo/fechaDesde/fechaHasta/extremosInclusivos) and `origen` (origenLocalId/origenPuntoDeVentaId) exactly — the only thing that differs is `entidadId`.
- Verification invariant: for every split, every `compraRowId` the old rule had distributed must be `esDistribuido = true` again after the migration, and the sum of `importeCalculado` across the new rules for exactly that original set of `compraRowId`s must equal the pre-migration total for the old rule. (Not a stricter "totals match exactly" check — a new rule may legitimately also pick up previously-undistributed compras of its code that the old rule never had a chance to claim; that's a correct side effect, not a bug, and is reported separately.)

---

## Investigation (grounds Task 1's test fixtures — re-verify live before Task 3's `--apply`)

Queried 2026-09-28 against production. 32 active rules at nivel "proveedor" with old-format `entidadId`. Per-rule breakdown of codes among each rule's ACTUAL `distribuciones_apertura` (not name-wide):

| reglaId | entidadId | códigos (compras, $) | decisión |
|---|---|---|---|
| 175 | texto:camila | 597 (127, $30.000.310), 660 (33, $4.385.131) | dividir |
| 186 | texto:lucas | 638 (18, $3.630.350) | renombrar → texto:lucas\|codigo:638 |
| 187 | texto:lucas | 543 (1, $3.890), 638 (16, $3.116.700) | dividir |
| 188 | texto:lucas | 638 (16, $4.334.965), 671 (2, $138.880) | dividir |
| 190 | texto:gabriel | 673 (1, $40.000) | renombrar → texto:gabriel\|codigo:673 |
| 199 | texto:micaela | 560 (54, $4.428.800) | renombrar → texto:micaela\|codigo:560 |
| 200 | texto:franco | 439 (4, $6.600), 532 (2, $8.860), 685 (40, $3.999.250) | dividir |
| 204 | texto:jorge | 506 (78, $2.181.710) | renombrar → texto:jorge\|codigo:506 |
| (24 more) | texto:diego, texto:santiagobenjamin ×2, texto:alejorodrigo ×2, texto:lautaroruben ×2, texto:vanesajudit ×3, texto:avril ×4, texto:uriel ×2, texto:ricardojuan ×2, texto:leandro, texto:brian, texto:jeremias, texto:noemi, texto:diegoalejandro, texto:alejo | 1 código cada una (no re-verificado individualmente por rule id — la investigación de fase de spec confirmó "1 solo código" a nivel de NOMBRE para estas 24, que es una garantía más fuerte que "1 código en sus distribuciones propias") | renombrar |

This table is **evidence for writing the tests**, not a hardcoded list the script consumes — the script queries this live at both dry-run and apply time, exactly like `fix-proveedorid-cruzado.ts` does.

---

## File Structure

| File | Responsibility |
|---|---|
| `scripts/migrar-reglas-proveedor-codigo.ts` | The whole migration: pure planning function + dry-run/apply CLI, mirrors `scripts/fix-proveedorid-cruzado.ts`'s shape |
| `scripts/migrar-reglas-proveedor-codigo.test.ts` | Tests for the pure planning function only (no DB) |

---

### Task 1: Pure planning function + tests

**Files:**
- Create: `scripts/migrar-reglas-proveedor-codigo.ts` (planning function only in this task — DB/CLI parts come in Task 2)
- Test: `scripts/migrar-reglas-proveedor-codigo.test.ts`

**Interfaces:**
- Consumes: `construirEntidadIdProveedorTexto` from `lib/proveedor-entidad-id.ts` (already in `main`).
- Produces: `decidirMigracionRegla(regla: ReglaCandidata): DecisionRegla`, `planificarMigracionReglas(reglas: ReglaCandidata[]): DecisionRegla[]` — Task 2's DB-querying code constructs `ReglaCandidata[]` from live data and calls these.

- [ ] **Step 1: Write the failing tests**

Create `scripts/migrar-reglas-proveedor-codigo.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { decidirMigracionRegla, planificarMigracionReglas, type ReglaCandidata } from "./migrar-reglas-proveedor-codigo";

function reglaCandidata(overrides: Partial<ReglaCandidata>): ReglaCandidata {
  return {
    id: 1,
    entidadId: "texto:diego",
    destinos: [{ localId: 1, puntoDeVentaId: 1, porcentaje: 100 }],
    vigencia: { modo: "historico", fechaDesde: null, fechaHasta: null, extremosInclusivos: true },
    origen: { origenLocalId: 1, origenPuntoDeVentaId: null },
    codigos: [],
    ...overrides,
  };
}

describe("decidirMigracionRegla", () => {
  it("sin distribuciones propias: omitir, no hay evidencia de qué código usar", () => {
    const decision = decidirMigracionRegla(reglaCandidata({ id: 42, codigos: [] }));
    expect(decision).toEqual({ tipo: "omitir", reglaId: 42, razon: "la regla no tiene compras ya distribuidas — no hay evidencia de qué código usar" });
  });

  it("un solo código entre sus distribuciones: renombrar, con el sufijo de ese código", () => {
    const decision = decidirMigracionRegla(reglaCandidata({
      id: 204, entidadId: "texto:jorge",
      codigos: [{ codigo: "506", cantidadCompras: 78, totalDistribuido: 2181710 }],
    }));
    expect(decision).toEqual({ tipo: "renombrar", reglaId: 204, entidadIdNuevo: "texto:jorge|codigo:506" });
  });

  it("dos codigos distintos entre sus distribuciones: dividir, uno por código", () => {
    const decision = decidirMigracionRegla(reglaCandidata({
      id: 175, entidadId: "texto:camila",
      codigos: [
        { codigo: "597", cantidadCompras: 127, totalDistribuido: 30000310 },
        { codigo: "660", cantidadCompras: 33, totalDistribuido: 4385131 },
      ],
    }));
    expect(decision).toEqual({ tipo: "dividir", reglaId: 175, codigosNuevos: ["597", "660"] });
  });

  it("tres codigos distintos (Franco): dividir en 3", () => {
    const decision = decidirMigracionRegla(reglaCandidata({
      id: 200, entidadId: "texto:franco",
      codigos: [
        { codigo: "439", cantidadCompras: 4, totalDistribuido: 6600 },
        { codigo: "532", cantidadCompras: 2, totalDistribuido: 8860 },
        { codigo: "685", cantidadCompras: 40, totalDistribuido: 3999250 },
      ],
    }));
    expect(decision).toEqual({ tipo: "dividir", reglaId: 200, codigosNuevos: ["439", "532", "685"] });
  });

  it("Lucas ventana 1 (id 186): un solo código en ESTA regla puntual, aunque el nombre tenga más códigos en otras ventanas de vigencia", () => {
    const decision = decidirMigracionRegla(reglaCandidata({
      id: 186, entidadId: "texto:lucas",
      codigos: [{ codigo: "638", cantidadCompras: 18, totalDistribuido: 3630350 }],
    }));
    expect(decision).toEqual({ tipo: "renombrar", reglaId: 186, entidadIdNuevo: "texto:lucas|codigo:638" });
  });

  it("Lucas ventana 2 (id 187): dos códigos en ESTA regla puntual, distinto del resultado de la ventana 1", () => {
    const decision = decidirMigracionRegla(reglaCandidata({
      id: 187, entidadId: "texto:lucas",
      codigos: [
        { codigo: "543", cantidadCompras: 1, totalDistribuido: 3890 },
        { codigo: "638", cantidadCompras: 16, totalDistribuido: 3116700 },
      ],
    }));
    expect(decision).toEqual({ tipo: "dividir", reglaId: 187, codigosNuevos: ["543", "638"] });
  });
});

describe("planificarMigracionReglas", () => {
  it("aplica decidirMigracionRegla a cada regla, preservando el orden", () => {
    const reglas = [
      reglaCandidata({ id: 1, entidadId: "texto:diego", codigos: [{ codigo: "120", cantidadCompras: 5, totalDistribuido: 1000 }] }),
      reglaCandidata({ id: 2, entidadId: "texto:sinnombre", codigos: [] }),
    ];
    const decisiones = planificarMigracionReglas(reglas);
    expect(decisiones).toHaveLength(2);
    expect(decisiones[0]).toEqual({ tipo: "renombrar", reglaId: 1, entidadIdNuevo: "texto:diego|codigo:120" });
    expect(decisiones[1].tipo).toBe("omitir");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run scripts/migrar-reglas-proveedor-codigo.test.ts`
Expected: FAIL — module `./migrar-reglas-proveedor-codigo` doesn't exist yet.

- [ ] **Step 3: Write the pure planning function**

Create `scripts/migrar-reglas-proveedor-codigo.ts` with exactly this content (the DB/CLI parts get appended in Task 2 — don't add them yet):

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run scripts/migrar-reglas-proveedor-codigo.test.ts`
Expected: PASS, all 7 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/migrar-reglas-proveedor-codigo.ts scripts/migrar-reglas-proveedor-codigo.test.ts
git commit -m "feat(apertura): función pura para decidir cómo migrar cada regla de proveedor al formato con código"
```

---

### Task 2: Script CLI — dry-run

**Files:**
- Modify: `scripts/migrar-reglas-proveedor-codigo.ts` (append DB-querying + dry-run CLI to the file Task 1 created)

**Interfaces:**
- Consumes: `planificarMigracionReglas`, `ReglaCandidata`, `DecisionRegla` from Task 1 (same file).
- Produces: a CLI runnable as `npx tsx scripts/migrar-reglas-proveedor-codigo.ts` (dry-run) — Task 3 adds the `--apply` branch to this same file.

No new tests in this task (DB-querying code, same testing boundary as `fix-proveedorid-cruzado.ts`'s `main()` — verified by running it for real against the dry-run path, which writes but never mutates). Follow `scripts/fix-proveedorid-cruzado.ts` as the reference for structure and style throughout.

- [ ] **Step 1: Append the DB-querying and reporting code**

Append to `scripts/migrar-reglas-proveedor-codigo.ts`:

```ts
import { config } from "dotenv";
config({ path: ".env.local" });

import { fileURLToPath } from "url";
import * as path from "path";
import { prisma } from "../lib/prisma";

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

  console.log("\n(la rama --apply se agrega en la Task 3 de este plan — todavía no está implementada)");
}

const esEntrypointCli = process.argv[1] === fileURLToPath(import.meta.url);
if (esEntrypointCli) {
  main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => (prisma as unknown as { $disconnect: () => Promise<void> }).$disconnect());
}
```

- [ ] **Step 2: Run the dry-run against the real database**

Run: `npx tsx scripts/migrar-reglas-proveedor-codigo.ts`
Expected: prints the plan (renombrar/dividir/omitir breakdown), matching the shape of the Investigation table above (re-verify the exact rule ids/codes still match — compras keep importing, so don't assume the investigation table is still byte-exact days later). Writes `tmp/migrar-reglas-proveedor-codigo/plan-dry-run.json`. No database writes (read-only queries only).

- [ ] **Step 3: Typecheck and run the full test suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors, all tests pass (Task 1's 7 new tests plus the existing suite).

- [ ] **Step 4: Commit**

```bash
git add scripts/migrar-reglas-proveedor-codigo.ts
git commit -m "feat(apertura): dry-run del script de migración de reglas proveedor a nombre+código"
```

- [ ] **Step 5: STOP — do not proceed to Task 3 automatically**

Show the dry-run output (console output and/or `tmp/migrar-reglas-proveedor-codigo/plan-dry-run.json`) to the user. Task 3 writes to the production database and reverts/redistributes real money — it requires the user's explicit, separate confirmation after they've seen this exact dry-run output. If executing this plan autonomously (subagent-driven-development or otherwise), this is a hard stop: report the dry-run results and wait. Do not dispatch or execute Task 3 without that confirmation, no matter what earlier green light covered Tasks 1-2.

---

### Task 3: Script CLI — `--apply` (gated on user confirmation from Task 2, Step 5)

**Files:**
- Modify: `scripts/migrar-reglas-proveedor-codigo.ts` (replace the placeholder `--apply` branch from Task 2)

**Interfaces:**
- Consumes: `revertirRegla`, `aplicarRegla` from `lib/apertura/motor.ts` (already in `main`); `AperturaDbClient` type from the same file.
- Produces: the finished script.

- [ ] **Step 1: Implement the `--apply` branch**

In `scripts/migrar-reglas-proveedor-codigo.ts`, add these imports near the top (alongside the existing ones):

```ts
import { revertirRegla, aplicarRegla, type AperturaDbClient } from "../lib/apertura/motor";
import type { ReglaVigencia } from "../lib/apertura/vigencia";
```

Replace the placeholder line:
```ts
  console.log("\n(la rama --apply se agrega en la Task 3 de este plan — todavía no está implementada)");
```
with:
```ts
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

    // Pre-imagen: qué compras y cuánta plata tenía la regla vieja ANTES de
    // tocar nada — es el invariante contra el que se verifica después.
    const preImagen = await prisma.$queryRawUnsafe<{ compraRowId: string; total: string }[]>(
      `SELECT "compraRowId", SUM("importeCalculado") as total FROM distribuciones_apertura
       WHERE "reglaId" = $1 GROUP BY "compraRowId"`,
      decision.reglaId
    );
    const totalPreImagen = preImagen.reduce((s, r) => s + Number(r.total), 0);
    const rowIdsPreImagen = new Set(preImagen.map((r) => r.compraRowId));

    const idsNuevasReglas = await prisma.$transaction(async (tx: AperturaDbClient) => {
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

      return nuevosIds;
    }, { timeout: 30000, maxWait: 20000 });

    // Verificación: toda compra que la regla vieja tenía distribuida debe
    // volver a estar esDistribuido=true, y la plata total de ESE MISMO
    // conjunto de compras (no un total global, que podría incluir compras
    // nuevas legítimamente barridas por la regla específica) debe coincidir
    // con la pre-imagen — spec §4.2 "el total no debe cambiar, solo cómo se reparte".
    const postImagen = await prisma.$queryRawUnsafe<{ compraRowId: string; total: string }[]>(
      `SELECT "compraRowId", SUM("importeCalculado") as total FROM distribuciones_apertura
       WHERE "reglaId" = ANY($1::int[]) AND "compraRowId" = ANY($2::text[])
       GROUP BY "compraRowId"`,
      idsNuevasReglas,
      [...rowIdsPreImagen]
    );
    const totalPostImagen = postImagen.reduce((s, r) => s + Number(r.total), 0);
    if (postImagen.length !== rowIdsPreImagen.size) {
      throw new Error(
        `Verificación falló para regla vieja #${decision.reglaId}: ${rowIdsPreImagen.size} compras tenía distribuidas, ` +
          `${postImagen.length} quedaron cubiertas por las reglas nuevas (${idsNuevasReglas.join(", ")}). Revisar manualmente.`
      );
    }
    if (Math.abs(totalPostImagen - totalPreImagen) > 0.01) {
      throw new Error(
        `Verificación falló para regla vieja #${decision.reglaId}: total antes $${totalPreImagen}, total después $${totalPostImagen} ` +
          `sobre el mismo conjunto de compras. Revisar manualmente.`
      );
    }

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
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean. If `tx.reglaApertura`/`tx.destinoRegla` aren't recognized on the `AperturaDbClient` type, check `lib/apertura/motor.ts`'s type definition — it's `Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">`, which does include model delegates like `reglaApertura`/`destinoRegla`, so this should just work; if it doesn't, report back rather than casting around the type error.

- [ ] **Step 3: Confirm with the user before running `--apply` for real**

This step is not automatable — stop here and get the user's explicit go-ahead, showing them the dry-run output from Task 2 (re-run it fresh first, since time has passed and new compras may have imported):

Run: `npx tsx scripts/migrar-reglas-proveedor-codigo.ts` (dry-run, no `--apply`)

Show the output to the user. Only after they explicitly confirm, run:

Run: `npx tsx scripts/migrar-reglas-proveedor-codigo.ts --apply`
Expected: prints per-rule progress (renamed / split-with-verification), a final summary, and writes `tmp/migrar-reglas-proveedor-codigo/plan-aplicado.json`. Any verification failure throws and aborts that rule's transaction (already-processed rules before it stay committed — report exactly which rule failed and stop, don't retry automatically).

- [ ] **Step 4: Post-apply verification**

Run: `npx vitest run && npx tsc --noEmit`
Expected: clean (this script's write path doesn't change any application code, just data — this just confirms nothing else regressed).

Then a manual spot-check against the live dashboard (Compras x Proveedor, rubro Gastos En Personal, a local/período covering one of the migrated names e.g. "Camila") — confirm the total shown for that name across its (now split) rows still matches what it showed before the migration, just split into more rows.

- [ ] **Step 5: Commit**

```bash
git add scripts/migrar-reglas-proveedor-codigo.ts
git commit -m "feat(apertura): implementa --apply del script de migración de reglas proveedor a nombre+código

Migra reglas activas de nivel proveedor en formato viejo (texto:<nombre>)
al formato con código (texto:<nombre>|codigo:<codigo>): rename in-place
cuando la regla solo distribuyó una persona real en la práctica, o
revierte+redistribuye cuando mezclaba más de una (ej. Camila, Franco,
Lucas en 2 de sus 3 ventanas de vigencia). Verificado contra producción:
[completar con el resumen real de la corrida — N renombradas, M divididas,
K omitidas, \$X verificados sin cambios de total].

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

(Fill in the bracketed summary with the real numbers from Step 3's output before committing — this is data, not a placeholder to leave in.)

---

## Self-Review Notes

- **Spec coverage:** §4.1 (migrar seguras) → Task 3's "renombrar" branch. §4.2 (dividir ambiguas) → Task 3's "dividir" branch, using `revertirRegla`/`aplicarRegla` exactly as the spec names them. §4.3 (orden: código de aplicación antes del backfill) → already satisfied, this plan's prerequisite (the nombre+código matching code) is already merged to `main`. Verification invariant (spec §4.2 "el total no debe cambiar") → Task 3 Step 1's post-imagen check.
- **Placeholder scan:** none in code; the one bracketed placeholder is explicitly flagged as "fill in before committing," not left as dead text in the plan.
- **Type consistency:** `ReglaCandidata`, `CodigoConteo`, `DecisionRegla` defined once in Task 1, consumed unchanged by Task 2's DB code and Task 3's apply code — same names throughout.
- **Departure from the original per-name framing:** earlier investigation (in conversation, not this plan) classified rules as "24 safe" vs "8 ambiguous" by NAME-wide code counts. This plan instead decides per RULE from what that specific rule already distributed — stricter and self-correcting (e.g. rule #186, one of "Lucas"'s 3 vigencia windows, turns out to only have ever distributed one code in practice, so it's a simple rename, not a split, even though "Lucas" as a name has 3 codes across its 3 rules). The script computes this live; nothing here depends on the old per-name classification being remembered correctly.
