# Limpieza de compras duplicadas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Nota:** las Tasks 1-2 son desarrollo normal de código con TDD, delegables a un subagente. La Task 3 (ejecución real contra producción) tiene dos puntos que requieren confirmación humana explícita en el momento — revisar el resultado del dry-run antes de aprobar seguir, y confirmar que el `pg_dump` ya se corrió antes de ejecutar `--apply` — el `--apply` en sí es la acción más sensible de todo este plan (borra datos financieros reales) y necesita luz verde en el momento, no alcanza con que la spec ya esté aprobada.

**Goal:** Borrar de forma segura y auditable las 4.585 filas de compras duplicadas del esquema viejo de `rowId`, identificadas en la investigación de causa raíz de esta sesión.

**Architecture:** Un script (`scripts/cleanup-duplicados-compras.ts`) con una función pura testeable (`planCleanupDuplicados`) que decide qué borrar, separada de la ejecución (dry-run por default, `--apply` para escribir de verdad) — mismo patrón que `scripts/migrate-rowid-compras.ts`, ya existente en este repo.

**Tech Stack:** TypeScript, Prisma 7, vitest, tsx.

**Spec:** `docs/superpowers/specs/2026-08-21-limpieza-duplicados-compras-design.md`

## Global Constraints

- El script vive permanentemente en el repo, con test (spec sección 3).
- La fuente de verdad al momento de borrar se recalcula EN VIVO contra la base real — nunca se reusa un plan calculado antes (spec sección 3 y 4.3).
- `pg_dump` completo es precondición manual antes de `--apply` — lo corre el usuario, el script no lo automatiza (spec sección 5).
- Todo el borrado corre dentro de una única `prisma.$transaction` (spec sección 5).
- Grupos con forma inesperada, `esDistribuido=true`, o `detalle_compras` propio en la fila candidata a borrar se EXCLUYEN automáticamente, nunca se fuerza el borrado de un caso no verificado como seguro (spec sección 4.1).
- Export del listado borrado a JSON fuera del repo, en `/private/tmp/claude-501/-Users-imanolalvarez-Documents-lazarillo-gestion/40e2565b-fdcf-460c-9387-ff8d7f319ad4/scratchpad/` (mismo directorio ya usado en la investigación de esta sesión).

---

### Task 1: Función pura `planCleanupDuplicados` (TDD)

**Files:**
- Create: `scripts/cleanup-duplicados-compras.ts`
- Test: `scripts/cleanup-duplicados-compras.test.ts`

**Interfaces:**
- Consumes: `computeCompraRowId`, `compraIdentityFromDbRecord`, `canonicalDecimal` de `lib/etl/normalizers/compra-identity.ts` (ya existen, sin cambios).
- Produces: `interface CompraParaLimpieza`, `interface PlanLimpieza`, `function planCleanupDuplicados(compras: CompraParaLimpieza[]): PlanLimpieza` — usados por Task 2.

- [ ] **Step 1: Escribir el test (falla — el archivo `cleanup-duplicados-compras.ts` todavía no existe)**

```typescript
import { describe, it, expect } from "vitest";
import { planCleanupDuplicados, type CompraParaLimpieza } from "./cleanup-duplicados-compras";
import { computeCompraRowId, compraIdentityFromDbRecord } from "../lib/etl/normalizers/compra-identity";

const BASE = {
  codCga: "GASTO1",
  fecha: new Date("2026-04-16"),
  codigo: "PROV1",
  concepto: "Packaging",
  comprobante: "A000200076930",
  detalle: "A  0002-00076930",
  observac: "Porta Cinta",
  importe: { toString: () => "49399.99" },
};

function rowIdNuevoPara(datos: typeof BASE): string {
  return computeCompraRowId(compraIdentityFromDbRecord(datos));
}

function filaNueva(overrides: Partial<CompraParaLimpieza> = {}): CompraParaLimpieza {
  return {
    ...BASE,
    rowId: rowIdNuevoPara(BASE),
    esDistribuido: false,
    tieneDetalleCompras: false,
    ...overrides,
  };
}

function filaVieja(overrides: Partial<CompraParaLimpieza> = {}): CompraParaLimpieza {
  return {
    ...BASE,
    rowId: "hash-esquema-viejo-1",
    esDistribuido: false,
    tieneDetalleCompras: false,
    ...overrides,
  };
}

describe("planCleanupDuplicados", () => {
  it("grupo limpio de 1 vieja + 1 nueva: la vieja va a rowIdABorrar", () => {
    const plan = planCleanupDuplicados([filaVieja(), filaNueva()]);
    expect(plan.rowIdABorrar).toEqual(["hash-esquema-viejo-1"]);
    expect(plan.gruposExcluidos).toHaveLength(0);
  });

  it("candidata a borrar con esDistribuido=true: grupo excluido, no se borra nada", () => {
    const plan = planCleanupDuplicados([filaVieja({ esDistribuido: true }), filaNueva()]);
    expect(plan.rowIdABorrar).toHaveLength(0);
    expect(plan.gruposExcluidos).toHaveLength(1);
    expect(plan.gruposExcluidos[0].motivo).toBe("la fila candidata a borrar tiene esDistribuido=true");
  });

  it("candidata a borrar con tieneDetalleCompras=true: grupo excluido", () => {
    const plan = planCleanupDuplicados([filaVieja({ tieneDetalleCompras: true }), filaNueva()]);
    expect(plan.rowIdABorrar).toHaveLength(0);
    expect(plan.gruposExcluidos).toHaveLength(1);
    expect(plan.gruposExcluidos[0].motivo).toBe("la fila candidata a borrar tiene detalle_compras propio");
  });

  it("grupo con 3 filas: excluido por forma inesperada", () => {
    const plan = planCleanupDuplicados([
      filaVieja({ rowId: "hash-viejo-a" }),
      filaVieja({ rowId: "hash-viejo-b" }),
      filaNueva(),
    ]);
    expect(plan.rowIdABorrar).toHaveLength(0);
    expect(plan.gruposExcluidos).toHaveLength(1);
    expect(plan.gruposExcluidos[0].motivo).toBe("forma inesperada (no es 1 vieja + 1 nueva)");
  });

  it("dos filas que matchean AMBAS el esquema nuevo: excluido por forma inesperada", () => {
    const plan = planCleanupDuplicados([filaNueva(), filaNueva()]);
    expect(plan.rowIdABorrar).toHaveLength(0);
    expect(plan.gruposExcluidos).toHaveLength(1);
    expect(plan.gruposExcluidos[0].motivo).toBe("forma inesperada (no es 1 vieja + 1 nueva)");
  });

  it("sin duplicados (compras de grupos distintos): rowIdABorrar vacío, sin exclusiones", () => {
    const otra = filaNueva({
      rowId: rowIdNuevoPara({ ...BASE, codigo: "PROV2" }),
      codigo: "PROV2",
    });
    const plan = planCleanupDuplicados([filaNueva(), otra]);
    expect(plan.rowIdABorrar).toHaveLength(0);
    expect(plan.gruposExcluidos).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Correr el test para confirmar que falla**

Run: `npx vitest run scripts/cleanup-duplicados-compras.test.ts`
Expected: FAIL — no se puede resolver el módulo `./cleanup-duplicados-compras` (todavía no existe).

- [ ] **Step 3: Implementar `planCleanupDuplicados`**

```typescript
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
```

- [ ] **Step 4: Correr el test para confirmar que pasa**

Run: `npx vitest run scripts/cleanup-duplicados-compras.test.ts`
Expected: PASS — 6/6 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/cleanup-duplicados-compras.ts scripts/cleanup-duplicados-compras.test.ts
git commit -m "feat(apertura-gastos): agrega planCleanupDuplicados, decide qué compras duplicadas borrar"
```

---

### Task 2: `main()` — dry-run y `--apply` contra la base real

**Files:**
- Modify: `scripts/cleanup-duplicados-compras.ts` (reemplazar el `main()` placeholder de Task 1)

**Interfaces:**
- Consumes: `planCleanupDuplicados`, `CompraParaLimpieza`, `PlanLimpieza` de Task 1.
- Produces: comportamiento CLI completo (`npx tsx scripts/cleanup-duplicados-compras.ts` y con `--apply`) — consumido directamente por Task 3, no por otro código.

- [ ] **Step 1: Reemplazar el `main()` placeholder**

```typescript
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
```

Nota: `await import("fs")` dentro de `exportarDetalle` (en vez de `import` estático arriba del archivo) sigue el mismo criterio que ya usa `migrate-rowid-compras.ts` — evita cargar el módulo `fs` en el path de quien importa este archivo solo para usar `planCleanupDuplicados` en un test.

- [ ] **Step 2: Correr `tsc` para confirmar que el archivo completo compila**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 3: Correr el test de Task 1 de nuevo — confirmar que sigue pasando (el `main()` nuevo no debe afectar la función pura)**

Run: `npx vitest run scripts/cleanup-duplicados-compras.test.ts`
Expected: PASS — 6/6 tests, igual que en Task 1.

- [ ] **Step 4: Commit**

```bash
git add scripts/cleanup-duplicados-compras.ts
git commit -m "feat(apertura-gastos): agrega dry-run/--apply a cleanup-duplicados-compras.ts"
```

---

### Task 3: Ejecución real contra producción

**Files:** ninguno — este task no modifica código, ejecuta el script de Task 2.

**Interfaces:**
- Consumes: el script completo de Task 2.
- Produces: la base de producción sin las 4.585 filas duplicadas del esquema viejo, con respaldo (`pg_dump` + JSON exportado).

- [ ] **Step 1: Dry-run**

```bash
npx tsx scripts/cleanup-duplicados-compras.ts
```

Expected: termina sin error, imprime `Filas a borrar: 4585` (o el número real al momento de correrlo, puede diferir levemente de la investigación de esta sesión si pasó tiempo), `Grupos excluidos: 0` (según lo verificado hoy — si aparece cualquier grupo excluido, es información nueva a revisar antes de seguir, no un error del script).

- [ ] **Step 2: Revisar el resultado con el usuario (confirmación humana explícita)**

Mostrar el resumen impreso y preguntarle al usuario: "¿el número de filas a borrar y de grupos excluidos tiene sentido, seguimos?" — no avanzar al Step 3 sin una respuesta explícita.

- [ ] **Step 3: `pg_dump` (lo corre el usuario, confirmación humana explícita)**

Pedirle al usuario que corra el backup completo de la base (mismo procedimiento ya usado en fases anteriores del proyecto) y que confirme explícitamente que terminó antes de seguir al Step 4. No ejecutar `--apply` sin esa confirmación en el momento.

- [ ] **Step 4: `--apply`**

```bash
npx tsx scripts/cleanup-duplicados-compras.ts --apply
```

Expected: termina con "Limpieza completada y verificada." — si en cambio imprime "⚠ VERIFICACIÓN FALLÓ", DETENERSE, no continuar a ningún otro paso ni de este plan ni de ningún otro, y reportarlo directo al usuario.

- [ ] **Step 5: Verificación final**

```bash
npx vitest run
npx tsc --noEmit
npm run lint
```

Expected: los tres limpios (mismo criterio de cierre que el resto de las fases de este proyecto). Además, confirmar manualmente contra la base: `prisma.compra.count()` bajó exactamente en la cantidad de filas borradas (ya lo verifica el propio script en el Step 4, esto es una segunda confirmación independiente si el usuario quiere correrla).

- [ ] **Step 6: Actualizar memoria del proyecto**

Actualizar `project_fix_duplicados_main_dev.md` (memoria del proyecto) marcando el punto pendiente #2 ("limpieza de los 4.585 grupos") como resuelto, con la fecha y cantidad real de filas borradas.
