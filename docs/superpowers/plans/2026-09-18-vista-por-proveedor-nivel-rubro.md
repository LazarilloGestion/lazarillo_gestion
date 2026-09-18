# Vista de Compras "por Proveedor" — nivel Rubro — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Insertar Rubro como nuevo nivel 0 en el árbol de la vista de Compras "por Proveedor" (toggle "Ver por: Proveedor"), corriendo Proveedor a nivel 1, Concepto a nivel 2 y línea de compra a nivel 3.

**Architecture:** Se agrega una capa de agrupación por rubro en la función pura que arma el árbol (`buildPivotDataByProveedor`), se propaga el nivel nuevo a los tipos, a las funciones de aplanado/orden, al hook de orquestación de UI y al render de la tabla. La vista "por Concepto" (árbol paralelo, no relacionado) no se toca.

**Tech Stack:** TypeScript estricto, Next.js API route (`app/api/dashboard/pivot/route.ts`, sin cambios), React (client component), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-18-vista-por-proveedor-nivel-rubro-design.md`

## Global Constraints

- No modificar la vista "por Concepto" (`PivotTableByConcepto`, `buildPivotData`, `PivotRubroRow`/`PivotConceptoRow`/`PivotProveedorRow`, `usePivotScreenData`, `flattenRows`/`sortPivotRows`) — es un árbol completamente separado y queda intacto.
- No modificar `AperturaGastosModal`, reglas de apertura, ni la prioridad registro > proveedor > concepto — el ícono Aperturar sigue apuntando a las mismas entidades (`nivel: "proveedor"` / `nivel: "concepto"`), solo cambia su indentado visual.
- No hay migraciones de Prisma ni cambios de schema.
- No se modifican datos de compras ya importados — solo cómo se agrupan para mostrarlos.
- Mantener la disciplina de `id` compuesto (rubro+proveedor+concepto+línea) para evitar colisiones de key de React cuando el rollup produce nodos repetidos.
- Sin test de browser (limitación ya aceptada en este proyecto) — la Task 5 es verificación manual contra datos reales antes de cerrar la tarea.

---

## Task 1: Tipos + armado del árbol (`lib/dashboard/types.ts`, `lib/dashboard/pivot-por-proveedor.ts`)

**Files:**
- Modify: `lib/dashboard/types.ts:65-115`
- Modify: `lib/dashboard/pivot-por-proveedor.ts` (archivo completo)
- Test: `lib/dashboard/pivot-por-proveedor.test.ts` (archivo completo, se reescribe)

**Interfaces:**
- Produces: `PivotRubroRowPorProveedor` (nivel 0, `children: PivotProveedorSubRow[]`), `PivotProveedorSubRow` (nivel 1, renombrado desde `PivotProveedorTopRow`, `children: PivotConceptoSubRow[]`), `PivotConceptoSubRow` (nivel 2, sin cambios de campos), `PivotLineaRow` (nivel 3, sin cambios de campos), `PivotDataPorProveedor.rows: PivotRubroRowPorProveedor[]`. `buildPivotDataByProveedor(sqlRows: SqlRow[], composicionPorProveedor: Record<string, Record<number, ComposicionMes>>): PivotDataPorProveedor` mantiene la misma firma.

- [ ] **Step 1: Reescribir los tests de `buildPivotDataByProveedor` para el árbol de 4 niveles**

Reemplazar el contenido completo de `lib/dashboard/pivot-por-proveedor.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildPivotDataByProveedor } from "./pivot-por-proveedor";
import { SIN_PROVEEDOR_NOMBRE } from "./constants";
import type { SqlRow } from "./types";

function row(overrides: Partial<SqlRow>): SqlRow {
  return {
    rubro_codigo: "R1", rubro_nombre: "Rubro 1",
    concepto_codigo: "C1", concepto_nombre: "Concepto 1",
    proveedor_id: 1, proveedor_nombre: "Proveedor A",
    mes: 1, total: 100, row_id: "row-1", distribucion_id: null,
    fecha: "2026-01-01", observac: null, has_manual_override: false,
    local_id_origen: null, punto_de_venta_id_origen: null,
    ...overrides,
  };
}

describe("buildPivotDataByProveedor", () => {
  it("agrupa por rubro, luego proveedor, luego concepto, sin mezclar proveedores", () => {
    const rows: SqlRow[] = [
      row({ proveedor_id: 1, proveedor_nombre: "Proveedor A", concepto_codigo: "C1", row_id: "a1", total: 100 }),
      row({ proveedor_id: 2, proveedor_nombre: "Proveedor B", concepto_codigo: "C1", row_id: "b1", total: 200 }),
    ];
    const data = buildPivotDataByProveedor(rows, {});

    expect(data.rows).toHaveLength(1);
    const rubro = data.rows[0];
    expect(rubro.children).toHaveLength(2);
    const provA = rubro.children.find((p) => p.proveedorId === 1)!;
    const provB = rubro.children.find((p) => p.proveedorId === 2)!;
    expect(provA.rowTotal).toBe(100);
    expect(provB.rowTotal).toBe(200);
    expect(provA.children).toHaveLength(1);
    expect(provA.children[0].conceptoCodigo).toBe("C1");
    expect(provA.children[0].rowTotal).toBe(100);
  });

  it("un proveedor con compras en dos rubros aparece duplicado, uno por rubro, sin mezclar importes", () => {
    const rows: SqlRow[] = [
      row({ rubro_codigo: "R1", rubro_nombre: "Rubro 1", proveedor_id: 1, concepto_codigo: "C1", row_id: "a1", total: 100 }),
      row({ rubro_codigo: "R2", rubro_nombre: "Rubro 2", proveedor_id: 1, concepto_codigo: "C2", concepto_nombre: "Concepto 2", row_id: "a2", total: 300 }),
    ];
    const data = buildPivotDataByProveedor(rows, {});

    expect(data.rows).toHaveLength(2);
    const rubro1 = data.rows.find((r) => r.rubroCodigo === "R1")!;
    const rubro2 = data.rows.find((r) => r.rubroCodigo === "R2")!;
    expect(rubro1.children).toHaveLength(1);
    expect(rubro2.children).toHaveLength(1);
    expect(rubro1.children[0].proveedorId).toBe(1);
    expect(rubro2.children[0].proveedorId).toBe(1);
    expect(rubro1.children[0].rowTotal).toBe(100);
    expect(rubro2.children[0].rowTotal).toBe(300);
    expect(rubro1.children[0].id).not.toBe(rubro2.children[0].id);
    expect(data.grandTotal).toBe(400);
  });

  it("rollup mensual correcto en proveedor y rubro, y en los totales generales", () => {
    const rows: SqlRow[] = [
      row({ proveedor_id: 1, concepto_codigo: "C1", row_id: "a1", mes: 1, total: 100 }),
      row({ proveedor_id: 1, concepto_codigo: "C2", concepto_nombre: "Concepto 2", row_id: "a2", mes: 1, total: 50 }),
    ];
    const data = buildPivotDataByProveedor(rows, {});
    const rubro = data.rows[0];
    const provA = rubro.children[0];
    expect(provA.values[1]).toBe(150);
    expect(provA.rowTotal).toBe(150);
    expect(rubro.values[1]).toBe(150);
    expect(rubro.rowTotal).toBe(150);
    expect(data.columnTotals[1]).toBe(150);
    expect(data.grandTotal).toBe(150);
  });

  it("proveedor null usa la clave __sin_proveedor y muestra el label sentinela sin importar el texto crudo del ERP", () => {
    const rows: SqlRow[] = [
      row({ proveedor_id: null, proveedor_nombre: "CARNICERIA LOPEZ SRL", row_id: "x1", total: 10 }),
    ];
    const data = buildPivotDataByProveedor(rows, {});
    const proveedor = data.rows[0].children[0];
    expect(proveedor.proveedorId).toBeNull();
    expect(proveedor.nombre).toBe(SIN_PROVEEDOR_NOMBRE);
  });

  it("adjunta la composición correspondiente a cada concepto+proveedor, sin importar el rubro", () => {
    const rows: SqlRow[] = [row({ proveedor_id: 1, concepto_codigo: "C1", row_id: "a1" })];
    const composicion = { "C1|1": { 1: { total: 100, destinos: [{ nombre: "Local A", pct: 100, importe: 100 }] } } };
    const data = buildPivotDataByProveedor(rows, composicion);
    expect(data.rows[0].children[0].children[0].composicion).toEqual(composicion["C1|1"]);
  });

  it("dos líneas de la misma compra distribuida no colisionan de id", () => {
    const rows: SqlRow[] = [
      row({ proveedor_id: 1, concepto_codigo: "C1", row_id: "a1", distribucion_id: 10, total: 60 }),
      row({ proveedor_id: 1, concepto_codigo: "C1", row_id: "a1", distribucion_id: 11, total: 40 }),
    ];
    const data = buildPivotDataByProveedor(rows, {});
    const lineaIds = data.rows[0].children[0].children[0].children.map((l) => l.id);
    expect(new Set(lineaIds).size).toBe(2);
  });
});
```

- [ ] **Step 2: Correr los tests y confirmar que fallan**

Run: `npx vitest run lib/dashboard/pivot-por-proveedor.test.ts`
Expected: FAIL (los tipos/shape actuales no tienen nivel de rubro — `data.rows[0].children` no existe todavía sobre el shape viejo).

- [ ] **Step 3: Actualizar los tipos en `lib/dashboard/types.ts`**

Reemplazar el bloque actual (líneas 65-115, desde el comentario `// --- Pivot row types "por proveedor"` hasta el cierre de `PivotDataPorProveedor`) por:

```ts
// --- Pivot row types "por proveedor" (Rubro → Proveedor → Concepto → línea) ---
// Tipos paralelos a PivotRubroRow/PivotConceptoRow/PivotProveedorRow de
// arriba, no reutilizados: forzar otro significado en `rubroCodigo` (p. ej.
// guardar ahí un proveedorId) sería confuso. Ver
// docs/superpowers/specs/2026-09-18-vista-por-proveedor-nivel-rubro-design.md.

export type PivotLineaRow = {
  readonly level: 3;
  readonly id: string;
  readonly rowId: string;
  readonly distribucionId: number | null;
  readonly conceptoCodigo: string;
  readonly fecha: string | null;
  readonly observac: string | null;
  readonly importe: number;
  readonly hasManualOverride: boolean;
  readonly localIdOrigen: number | null;
  readonly puntoDeVentaIdOrigen: number | null;
  values: Record<number, number>;
  rowTotal: number;
};

export type PivotConceptoSubRow = {
  readonly level: 2;
  readonly id: string;
  readonly nombre: string;
  readonly conceptoCodigo: string;
  readonly rubroCodigo: string;
  readonly proveedorId: number | null;
  values: Record<number, number>;
  rowTotal: number;
  children: PivotLineaRow[];
  composicion?: Record<number, ComposicionMes>;
};

export type PivotProveedorSubRow = {
  readonly level: 1;
  readonly id: string;
  readonly nombre: string;
  readonly proveedorId: number | null;
  values: Record<number, number>;
  rowTotal: number;
  children: PivotConceptoSubRow[];
};

export type PivotRubroRowPorProveedor = {
  readonly level: 0;
  readonly id: string;
  readonly nombre: string;
  readonly rubroCodigo: string;
  values: Record<number, number>;
  rowTotal: number;
  children: PivotProveedorSubRow[];
};

export type PivotDataPorProveedor = {
  rows: PivotRubroRowPorProveedor[];
  columnTotals: Record<number, number>;
  grandTotal: number;
};
```

- [ ] **Step 4: Reescribir `buildPivotDataByProveedor` en `lib/dashboard/pivot-por-proveedor.ts`**

Reemplazar el archivo completo:

```ts
import { SIN_PROVEEDOR_KEY, SIN_PROVEEDOR_NOMBRE } from "./constants";
import type {
  SqlRow,
  ComposicionMes,
  PivotDataPorProveedor,
  PivotRubroRowPorProveedor,
  PivotProveedorSubRow,
  PivotConceptoSubRow,
  PivotLineaRow,
} from "./types";

// Hermana de buildPivotData (app/api/dashboard/pivot/route.ts): misma fuente
// de filas (SqlRow[], una por línea de compra con rubro/concepto/proveedor ya
// resueltos), pero agrupa Rubro → Proveedor → Concepto → línea. Ver spec
// docs/superpowers/specs/2026-09-18-vista-por-proveedor-nivel-rubro-design.md §3.2.
export function buildPivotDataByProveedor(
  sqlRows: SqlRow[],
  composicionPorProveedor: Record<string, Record<number, ComposicionMes>>
): PivotDataPorProveedor {
  const rubroMap = new Map<string, PivotRubroRowPorProveedor>();
  const proveedorMap = new Map<string, PivotProveedorSubRow>();
  const conceptoMap = new Map<string, PivotConceptoSubRow>();

  for (const row of sqlRows) {
    const {
      rubro_codigo,
      rubro_nombre,
      proveedor_id,
      proveedor_nombre,
      concepto_codigo,
      concepto_nombre,
      mes,
      total,
      row_id,
      distribucion_id,
      fecha,
      observac,
      has_manual_override,
      local_id_origen,
      punto_de_venta_id_origen,
    } = row;

    const t = typeof total === "object" && total !== null ? Number(total.toString()) : Number(total);

    // provKeyOriginal identifica al proveedor a secas (usado para la clave de
    // composición, que no sabe de rubros); provKey lo compone con el rubro
    // para que el mismo proveedor genere un nodo distinto por cada rubro en
    // el que tiene compras (mismo criterio de duplicación que ya usa
    // buildPivotData con sus proveedores-hoja).
    const provKeyOriginal = proveedor_id != null ? String(proveedor_id) : SIN_PROVEEDOR_KEY;
    const provKey = `${rubro_codigo}|${provKeyOriginal}`;
    const concKey = `${provKey}|${concepto_codigo}`;

    if (!rubroMap.has(rubro_codigo)) {
      rubroMap.set(rubro_codigo, {
        level: 0,
        id: rubro_codigo,
        nombre: rubro_nombre,
        rubroCodigo: rubro_codigo,
        values: {},
        rowTotal: 0,
        children: [],
      });
    }
    const rubro = rubroMap.get(rubro_codigo)!;

    if (!proveedorMap.has(provKey)) {
      const proveedor: PivotProveedorSubRow = {
        level: 1,
        id: provKey,
        nombre: proveedor_id != null ? proveedor_nombre : SIN_PROVEEDOR_NOMBRE,
        proveedorId: proveedor_id,
        values: {},
        rowTotal: 0,
        children: [],
      };
      proveedorMap.set(provKey, proveedor);
      rubro.children.push(proveedor);
    }
    const proveedor = proveedorMap.get(provKey)!;

    if (!conceptoMap.has(concKey)) {
      const concepto: PivotConceptoSubRow = {
        level: 2,
        id: concKey,
        nombre: concepto_nombre,
        conceptoCodigo: concepto_codigo,
        rubroCodigo: rubro_codigo,
        proveedorId: proveedor_id,
        values: {},
        rowTotal: 0,
        children: [],
        composicion: composicionPorProveedor[`${concepto_codigo}|${provKeyOriginal}`],
      };
      conceptoMap.set(concKey, concepto);
      proveedor.children.push(concepto);
    }
    const concepto = conceptoMap.get(concKey)!;

    const linea: PivotLineaRow = {
      level: 3,
      id: `${concKey}|${row_id}|${distribucion_id ?? "orig"}`,
      rowId: row_id,
      distribucionId: distribucion_id,
      conceptoCodigo: concepto_codigo,
      fecha: fecha ?? null,
      observac: observac ?? null,
      importe: t,
      hasManualOverride: !!has_manual_override,
      localIdOrigen: local_id_origen,
      puntoDeVentaIdOrigen: punto_de_venta_id_origen,
      values: { [mes]: t },
      rowTotal: t,
    };
    concepto.children.push(linea);
  }

  // Roll up bottom-up: línea → concepto → proveedor → rubro.
  for (const [, rubro] of rubroMap) {
    for (const proveedor of rubro.children) {
      for (const concepto of proveedor.children) {
        for (const linea of concepto.children) {
          for (const [m, val] of Object.entries(linea.values)) {
            const mn = Number(m);
            concepto.values[mn] = (concepto.values[mn] ?? 0) + val;
          }
          concepto.rowTotal += linea.rowTotal;
        }
        for (const [m, val] of Object.entries(concepto.values)) {
          const mn = Number(m);
          proveedor.values[mn] = (proveedor.values[mn] ?? 0) + val;
        }
        proveedor.rowTotal += concepto.rowTotal;
      }
      for (const [m, val] of Object.entries(proveedor.values)) {
        const mn = Number(m);
        rubro.values[mn] = (rubro.values[mn] ?? 0) + val;
      }
      rubro.rowTotal += proveedor.rowTotal;
    }
  }

  const columnTotals: Record<number, number> = {};
  let grandTotal = 0;
  for (const [, rubro] of rubroMap) {
    for (const [m, val] of Object.entries(rubro.values)) {
      const mn = Number(m);
      columnTotals[mn] = (columnTotals[mn] ?? 0) + val;
    }
    grandTotal += rubro.rowTotal;
  }

  return { rows: Array.from(rubroMap.values()), columnTotals, grandTotal };
}
```

- [ ] **Step 5: Correr los tests y confirmar que pasan**

Run: `npx vitest run lib/dashboard/pivot-por-proveedor.test.ts`
Expected: PASS (6/6).

- [ ] **Step 6: Confirmar que `apertura-composicion.ts` no necesita cambios**

Run: `grep -n "PivotProveedorTopRow\|PivotDataPorProveedor" lib/dashboard/apertura-composicion.ts`
Expected: sin resultados — `buildComposicionPorProveedor` usa la clave `concepto|proveedorId` (sin rubro) y no importa ningún tipo del árbol pivot, así que no se ve afectado por este cambio. No tocar este archivo.

- [ ] **Step 7: Commit**

```bash
git add lib/dashboard/types.ts lib/dashboard/pivot-por-proveedor.ts lib/dashboard/pivot-por-proveedor.test.ts
git commit -m "feat(dashboard): agrega nivel Rubro al árbol de datos de la vista por Proveedor"
```

---

## Task 2: Aplanado y orden (`lib/dashboard/pivot-utils.ts`)

**Files:**
- Modify: `lib/dashboard/pivot-utils.ts:1-4,16-29,78-123`
- Test: `lib/dashboard/pivot-utils.test.ts` (describe blocks de "por Proveedor", se reescriben)

**Interfaces:**
- Consumes: `PivotRubroRowPorProveedor`, `PivotProveedorSubRow`, `PivotConceptoSubRow`, `PivotLineaRow`, `PivotDataPorProveedor` (Task 1).
- Produces: `FlatRowPorProveedor` gana el variante `{ type: "rubroTop"; data: PivotRubroRowPorProveedor }` y renombra `"proveedorTop"` a `"proveedorSub"`. `flattenRowsPorProveedor(pivotData, expanded): FlatRowPorProveedor[]` y `sortPivotRowsPorProveedor(rows: PivotRubroRowPorProveedor[], col, dir): PivotRubroRowPorProveedor[]` mantienen firma pero el primer nivel ahora es rubro.

- [ ] **Step 1: Reescribir los tests de `sortPivotRowsPorProveedor`/`flattenRowsPorProveedor`**

En `lib/dashboard/pivot-utils.test.ts`, reemplazar los dos `describe` bloques existentes ("sortPivotRowsPorProveedor" y "flattenRowsPorProveedor", líneas 13-63) por:

```ts
function rubroRow(overrides: Partial<PivotRubroRowPorProveedor>): PivotRubroRowPorProveedor {
  return {
    level: 0, id: "R1", nombre: "Rubro 1", rubroCodigo: "R1",
    values: {}, rowTotal: 0, children: [],
    ...overrides,
  };
}

function proveedorRow(overrides: Partial<PivotProveedorSubRow>): PivotProveedorSubRow {
  return {
    level: 1, id: "R1|1", nombre: "Proveedor A", proveedorId: 1,
    values: {}, rowTotal: 0, children: [],
    ...overrides,
  };
}

describe("sortPivotRowsPorProveedor", () => {
  it("ordena rubros por total descendente", () => {
    const rows = [rubroRow({ id: "r1", rowTotal: 100 }), rubroRow({ id: "r2", rowTotal: 300 })];
    const sorted = sortPivotRowsPorProveedor(rows, "total", "desc");
    expect(sorted.map((r) => r.id)).toEqual(["r2", "r1"]);
  });

  it("no muta el array original", () => {
    const rows = [rubroRow({ id: "r1", rowTotal: 100 }), rubroRow({ id: "r2", rowTotal: 300 })];
    sortPivotRowsPorProveedor(rows, "total", "desc");
    expect(rows.map((r) => r.id)).toEqual(["r1", "r2"]);
  });
});

describe("flattenRowsPorProveedor", () => {
  it("solo incluye el nivel rubro cuando no hay nada expandido", () => {
    const data: PivotDataPorProveedor = { rows: [rubroRow({ id: "r1" })], columnTotals: {}, grandTotal: 0 };
    const flat = flattenRowsPorProveedor(data, new Set());
    expect(flat).toEqual([{ type: "rubroTop", data: data.rows[0] }]);
  });

  it("expande rubro, proveedor y concepto en cascada", () => {
    const linea: PivotLineaRow = {
      level: 3, id: "l1", rowId: "row-1", distribucionId: null, conceptoCodigo: "C1",
      fecha: null, observac: null, importe: 10, hasManualOverride: false,
      localIdOrigen: null, puntoDeVentaIdOrigen: null, values: {}, rowTotal: 10,
    };
    const concepto: PivotConceptoSubRow = {
      level: 2, id: "r1|p1|C1", nombre: "Concepto 1", conceptoCodigo: "C1", rubroCodigo: "r1", proveedorId: 1,
      values: {}, rowTotal: 10, children: [linea],
    };
    const proveedor = proveedorRow({ id: "r1|p1", children: [concepto] });
    const rubro = rubroRow({ id: "r1", children: [proveedor] });
    const data: PivotDataPorProveedor = { rows: [rubro], columnTotals: {}, grandTotal: 10 };

    const flat = flattenRowsPorProveedor(data, new Set(["r1", "r1|p1", "r1|p1|C1"]));
    expect(flat.map((f) => f.type)).toEqual(["rubroTop", "proveedorSub", "conceptoSub", "linea"]);
  });

  it("no expande proveedor si el rubro padre no está expandido", () => {
    const proveedor = proveedorRow({ id: "r1|p1" });
    const rubro = rubroRow({ id: "r1", children: [proveedor] });
    const data: PivotDataPorProveedor = { rows: [rubro], columnTotals: {}, grandTotal: 10 };

    const flat = flattenRowsPorProveedor(data, new Set(["r1|p1"]));
    expect(flat).toEqual([{ type: "rubroTop", data: rubro }]);
  });

  it("no expande concepto si el proveedor padre no está expandido", () => {
    const concepto: PivotConceptoSubRow = {
      level: 2, id: "r1|p1|C1", nombre: "Concepto 1", conceptoCodigo: "C1", rubroCodigo: "r1", proveedorId: 1,
      values: {}, rowTotal: 10, children: [],
    };
    const proveedor = proveedorRow({ id: "r1|p1", children: [concepto] });
    const rubro = rubroRow({ id: "r1", children: [proveedor] });
    const data: PivotDataPorProveedor = { rows: [rubro], columnTotals: {}, grandTotal: 10 };

    const flat = flattenRowsPorProveedor(data, new Set(["r1", "r1|p1|C1"]));
    expect(flat.map((f) => f.type)).toEqual(["rubroTop", "proveedorSub"]);
  });
});
```

Y actualizar el import del tipo al tope del archivo:
```ts
import type { PivotRubroRowPorProveedor, PivotProveedorSubRow, PivotConceptoSubRow, PivotLineaRow, PivotDataPorProveedor } from "./types";
```

- [ ] **Step 2: Correr los tests y confirmar que fallan**

Run: `npx vitest run lib/dashboard/pivot-utils.test.ts`
Expected: FAIL (compilación: `PivotRubroRowPorProveedor`/`PivotProveedorSubRow` no existen todavía en `pivot-utils.ts`, y `flattenRowsPorProveedor` no produce `"rubroTop"`/`"proveedorSub"`).

- [ ] **Step 3: Actualizar imports y `getValue` en `lib/dashboard/pivot-utils.ts`**

Reemplazar las líneas 1-4:
```ts
import type {
  DecimalLike, PivotData, PivotRubroRow, PivotConceptoRow, PivotProveedorRow,
  PivotDataPorProveedor, PivotRubroRowPorProveedor, PivotProveedorSubRow, PivotConceptoSubRow, PivotLineaRow,
} from "./types";
```

Reemplazar la firma de `getValue` (líneas 24-29):
```ts
function getValue(
  row: PivotRubroRow | PivotConceptoRow | PivotProveedorRow | PivotRubroRowPorProveedor | PivotProveedorSubRow | PivotConceptoSubRow | PivotLineaRow,
  col: SortCol
): number {
  return col === "total" ? row.rowTotal : (row.values[col as number] ?? 0);
}
```

- [ ] **Step 4: Reescribir `FlatRowPorProveedor`, `flattenRowsPorProveedor` y `sortPivotRowsPorProveedor`**

Reemplazar el bloque final del archivo (desde `export type FlatRowPorProveedor` hasta el cierre de `flattenRowsPorProveedor`, líneas 78-123 actuales) por:

```ts
/** Ordena el árbol "por proveedor" — misma lógica que sortPivotRows, sobre los tipos nuevos, con un nivel más (rubro). */
export function sortPivotRowsPorProveedor(
  rows: PivotRubroRowPorProveedor[],
  col: SortCol,
  dir: SortDir
): PivotRubroRowPorProveedor[] {
  const factor = dir === "desc" ? -1 : 1;
  return [...rows]
    .sort((a, b) => factor * (getValue(a, col) - getValue(b, col)))
    .map((rubro) => ({
      ...rubro,
      children: [...rubro.children]
        .sort((a, b) => factor * (getValue(a, col) - getValue(b, col)))
        .map((proveedor) => ({
          ...proveedor,
          children: [...proveedor.children]
            .sort((a, b) => factor * (getValue(a, col) - getValue(b, col)))
            .map((concepto) => ({
              ...concepto,
              children: [...concepto.children].sort(
                (a, b) => factor * (getValue(a, col) - getValue(b, col))
              ),
            })),
        })),
    }));
}

export type FlatRowPorProveedor =
  | { type: "rubroTop"; data: PivotRubroRowPorProveedor }
  | { type: "proveedorSub"; data: PivotProveedorSubRow }
  | { type: "conceptoSub"; data: PivotConceptoSubRow }
  | { type: "linea"; data: PivotLineaRow };

/** Aplana el árbol "por proveedor" respetando expansión — siempre 4 niveles (no hay variante maxDepth como en Ventas). */
export function flattenRowsPorProveedor(
  pivotData: PivotDataPorProveedor,
  expanded: Set<string>
): FlatRowPorProveedor[] {
  const result: FlatRowPorProveedor[] = [];
  for (const rubro of pivotData.rows) {
    result.push({ type: "rubroTop", data: rubro });
    if (!expanded.has(rubro.id)) continue;
    for (const proveedor of rubro.children) {
      result.push({ type: "proveedorSub", data: proveedor });
      if (!expanded.has(proveedor.id)) continue;
      for (const concepto of proveedor.children) {
        result.push({ type: "conceptoSub", data: concepto });
        if (!expanded.has(concepto.id)) continue;
        for (const linea of concepto.children) {
          result.push({ type: "linea", data: linea });
        }
      }
    }
  }
  return result;
}
```

- [ ] **Step 5: Correr los tests y confirmar que pasan**

Run: `npx vitest run lib/dashboard/pivot-utils.test.ts`
Expected: PASS (todos los tests del archivo, incluidos los de la vista "por Concepto" que no se tocaron).

- [ ] **Step 6: Commit**

```bash
git add lib/dashboard/pivot-utils.ts lib/dashboard/pivot-utils.test.ts
git commit -m "feat(dashboard): propaga el nivel Rubro a flatten/sort de la vista por Proveedor"
```

---

## Task 3: Hook de orquestación (`hooks/use-pivot-screen-data-por-proveedor.ts`)

**Files:**
- Modify: `hooks/use-pivot-screen-data-por-proveedor.ts` (archivo completo)

**Interfaces:**
- Consumes: `flattenRowsPorProveedor`, `sortPivotRowsPorProveedor` (Task 2).
- Produces: el hook gana `collapseProveedores` en su valor de retorno, junto a los ya existentes `collapseAll`/`collapseConceptos`.

No hay test automatizado de hooks en este proyecto (sin `@testing-library/react` en el stack) — este archivo se verifica junto con el render en la Task 5.

- [ ] **Step 1: Reemplazar el archivo completo**

```ts
"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useExpandableSet } from "@/hooks/use-expandable-set";
import { flattenRowsPorProveedor, sortPivotRowsPorProveedor, type SortCol, type SortDir } from "@/lib/dashboard/pivot-utils";
import type { PivotDataPorProveedor, DetalleFilter, VentasDetalleFilter } from "@/lib/dashboard/types";

interface UsePivotScreenDataPorProveedorParams {
  data: PivotDataPorProveedor | undefined;
  year: number;
  localId?: number;
  pdvId?: number;
  sortCol: SortCol;
  sortDir: SortDir;
  conceptoCodigo?: string;
  proveedorId?: number;
  observacionQuery?: string;
}

// Hermano de usePivotScreenData (lib/dashboard/pivot-utils.ts), para el árbol
// Rubro → Proveedor → Concepto → línea en vez de Rubro → Concepto → línea.
// Misma forma de retorno a propósito, para que PivotTableByProveedor consuma
// este hook igual que PivotTableByConcepto consume el original.
export function usePivotScreenDataPorProveedor({
  data, year, localId, pdvId, sortCol, sortDir, conceptoCodigo, proveedorId, observacionQuery,
}: UsePivotScreenDataPorProveedorParams) {
  const { expanded, setExpanded, toggle: toggleRow, collapseAll } = useExpandableSet();
  const [detalleFilter, setDetalleFilter] = useState<DetalleFilter | null>(null);
  const [ventasDetalleFilter, setVentasDetalleFilter] = useState<VentasDetalleFilter | null>(null);
  const prevFilterRef = useRef<{ conceptoCodigo?: string; proveedorId?: number; observacionQuery?: string }>({});

  useEffect(() => {
    if (!data) return;
    const prev = prevFilterRef.current;
    const filterChanged =
      prev.conceptoCodigo !== conceptoCodigo || prev.proveedorId !== proveedorId || prev.observacionQuery !== observacionQuery;
    prevFilterRef.current = { conceptoCodigo, proveedorId, observacionQuery };
    if (!filterChanged) return;

    if (conceptoCodigo || proveedorId || observacionQuery) {
      const ids = new Set<string>();
      for (const rubro of data.rows) {
        ids.add(rubro.id);
        for (const proveedor of rubro.children) {
          ids.add(proveedor.id);
          for (const concepto of proveedor.children) ids.add(concepto.id);
        }
      }
      setExpanded(ids);
    } else {
      setExpanded(new Set());
    }
  }, [data, conceptoCodigo, proveedorId, observacionQuery, setExpanded]);

  function openDetalle(extra: Omit<DetalleFilter, "year" | "localId" | "pdvId">) {
    setDetalleFilter({ year, localId, pdvId, ...extra });
  }

  const sortedRows = useMemo(
    () => (data ? sortPivotRowsPorProveedor(data.rows, sortCol, sortDir) : []),
    [data, sortCol, sortDir]
  );

  const flatRows = useMemo(
    () => flattenRowsPorProveedor({ rows: sortedRows, columnTotals: data?.columnTotals ?? {}, grandTotal: data?.grandTotal ?? 0 }, expanded),
    [sortedRows, expanded, data]
  );

  const rubroIds = useMemo(() => new Set(sortedRows.map((r) => r.id)), [sortedRows]);
  const proveedorIds = useMemo(
    () => new Set(sortedRows.flatMap((r) => r.children.map((p) => p.id))),
    [sortedRows]
  );

  // Click derecho en fila de Proveedor: colapsa proveedor+concepto+línea, mantiene el rubro expandido.
  const collapseProveedores = useCallback((e: React.MouseEvent) => {
    if (navigator.maxTouchPoints > 0) return;
    e.preventDefault();
    setExpanded((prev) => new Set([...prev].filter((id) => rubroIds.has(id))));
  }, [rubroIds, setExpanded]);

  // Click derecho en fila de Concepto: colapsa concepto+línea, mantiene rubro y proveedor expandidos.
  const collapseConceptos = useCallback((e: React.MouseEvent) => {
    if (navigator.maxTouchPoints > 0) return;
    e.preventDefault();
    setExpanded((prev) => new Set([...prev].filter((id) => rubroIds.has(id) || proveedorIds.has(id))));
  }, [rubroIds, proveedorIds, setExpanded]);

  return {
    expanded, toggleRow, collapseAll, collapseProveedores, collapseConceptos,
    sortedRows, flatRows, isEmpty: flatRows.length === 0,
    detalleFilter, setDetalleFilter, ventasDetalleFilter, setVentasDetalleFilter, openDetalle,
  };
}
```

- [ ] **Step 2: Verificar que el proyecto compila**

Run: `npx tsc --noEmit`
Expected: sin errores nuevos originados en este archivo (puede haber errores preexistentes en `pivot-table-por-proveedor.tsx` hasta la Task 4 — confirmar que son solo ahí).

- [ ] **Step 3: Commit**

```bash
git add hooks/use-pivot-screen-data-por-proveedor.ts
git commit -m "feat(dashboard): agrega collapseProveedores al hook de la vista por Proveedor"
```

---

## Task 4: Render de la tabla (`components/dashboard/pivot-table-por-proveedor.tsx`)

**Files:**
- Modify: `components/dashboard/pivot-table-por-proveedor.tsx` (archivo completo)

**Interfaces:**
- Consumes: `PivotRubroRowPorProveedor`, `PivotProveedorSubRow`, `PivotConceptoSubRow` (Task 1), `collapseProveedores` (Task 3), `flatRows: FlatRowPorProveedor[]` con variantes `"rubroTop" | "proveedorSub" | "conceptoSub" | "linea"` (Task 2).

- [ ] **Step 1: Reemplazar el archivo completo**

```tsx
"use client";
import { useMemo, useState } from "react";
import { useOperacionKpis } from "@/hooks/use-operacion-kpis";
import { usePivotScreenDataPorProveedor } from "@/hooks/use-pivot-screen-data-por-proveedor";
import { ExpandableButton } from "@/components/ui/expandable-button";
import { ChevronDown, ChevronUp, Split, Users } from "lucide-react";
import { cn, fmtARS, normalize } from "@/lib/utils";
import { MONTHS } from "@/lib/dashboard/constants";
import { hasValue } from "@/lib/dashboard/pivot-utils";
import { useDashboard } from "@/hooks/use-dashboard-store";
import { useReglasApertura } from "@/hooks/use-reglas-apertura";
import { origenAlcanza } from "@/lib/apertura/validaciones";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PivotLoading, PivotError, PivotEmpty } from "./pivot-states";
import { KpiBlock } from "./kpi-block";
import { EditedDot } from "./edit-row-controls";
import type { PivotDataPorProveedor, PivotRubroRowPorProveedor, PivotProveedorSubRow, PivotConceptoSubRow } from "@/lib/dashboard/types";
import { ComprasDetalleModal } from "./compras-detalle-modal";
import { VentasDetalleModal } from "./ventas-detalle-modal";
import { AperturaGastosModal } from "./apertura-gastos-modal";
import type { NivelRegla } from "@/lib/apertura/schemas";

export function PivotTableByProveedor() {
  const {
    year, localId, pdvId, rubroCodigo, conceptoCodigo, proveedorId, observacionQuery,
    months, activeMonths, sortCol, sortDir, handleSortClick,
    rubroConfigVersion, agrupacionCompras, setAgrupacionCompras,
  } = useDashboard();

  const [pctMode, setPctMode] = useState<"ingresos" | "egresos">("ingresos");
  const [apertura, setApertura] = useState<{
    nivel: NivelRegla;
    entidadId: string;
    entidadNombre: string;
    origenLocalId: number | null;
    origenPdvId: number | null;
  } | null>(null);
  const { reglas } = useReglasApertura();
  const reglasActivasPorNivel = useMemo(() => {
    const activas = reglas.filter((r) => r.estado === "activa");
    const alcanzaFiltro = (r: (typeof activas)[number]) => {
      if (pdvId == null && localId == null) return true;
      if (pdvId != null) {
        return origenAlcanza(
          { localId: r.origenLocalId, puntoDeVentaId: r.origenPuntoDeVentaId },
          { localId: localId ?? r.origenLocalId, puntoDeVentaId: pdvId }
        );
      }
      return r.origenLocalId === localId;
    };
    const alcanzadas = activas.filter(alcanzaFiltro);
    return {
      concepto: new Set(alcanzadas.filter((r) => r.nivel === "concepto").map((r) => r.entidadId)),
      proveedor: new Set(alcanzadas.filter((r) => r.nivel === "proveedor").map((r) => r.entidadId)),
      registro: new Set(alcanzadas.filter((r) => r.nivel === "registro").map((r) => r.entidadId)),
    };
  }, [reglas, localId, pdvId]);

  const { data, isLoading, error, ventasData, ventasLoading } = useOperacionKpis<PivotDataPorProveedor>({
    year, localId, pdvId, rubroCodigo, conceptoCodigo, proveedorId, observacionQuery,
    months, activeMonths, configVersion: rubroConfigVersion, agrupacion: "proveedor",
  });

  const {
    expanded, toggleRow, collapseAll, collapseProveedores, collapseConceptos,
    flatRows, detalleFilter, setDetalleFilter, ventasDetalleFilter, setVentasDetalleFilter, openDetalle,
  } = usePivotScreenDataPorProveedor({
    data, year, localId, pdvId, sortCol, sortDir, conceptoCodigo, proveedorId, observacionQuery,
  });

  if (isLoading) return <PivotLoading />;
  if (error) return <PivotError />;
  if (!data || data.rows.length === 0) return <PivotEmpty />;

  const pctDenominator = pctMode === "ingresos" ? (ventasData?.grandTotal ?? 0) : data.grandTotal;

  function fmtPct(rowTotal: number): string {
    if (pctMode === "ingresos" && ventasLoading) return "…";
    return pctDenominator > 0 ? `${((rowTotal / pctDenominator) * 100).toFixed(1)}%` : "—";
  }

  const ingresosPorMes = ventasData?.columnTotals ?? {};
  const egresosPorMes = data.columnTotals;

  return (
    <>
      <div className="overflow-auto flex-1 min-h-0">
        <table className="w-full text-sm border-separate border-spacing-0">
          <thead>
            <KpiBlock
              months={months}
              ingresosPorMes={ingresosPorMes}
              egresosPorMes={egresosPorMes}
              ingresosTotal={ventasData?.grandTotal}
              egresosTotal={data.grandTotal}
              ingresosReady={!!ventasData}
              variant="borderless"
              onIngresoCellClick={(mes) => setVentasDetalleFilter({ year, localId, pdvId, mes })}
              onIngresoTotalClick={() => setVentasDetalleFilter({ year, localId, pdvId })}
            />
            <tr className="bg-muted border-b">
              <th className="sticky left-0 top-0 z-30 bg-muted text-left px-4 py-3 font-medium text-muted-foreground min-w-[240px] whitespace-nowrap shadow-[1px_0_0_0_hsl(var(--border))]">
                <div className="flex items-center gap-1 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 p-0.5 w-fit">
                  <button
                    onClick={() => setAgrupacionCompras("concepto")}
                    aria-pressed={agrupacionCompras === "concepto"}
                    className={cn(
                      "h-7 px-2.5 rounded-md text-xs font-medium transition-all",
                      agrupacionCompras === "concepto"
                        ? "bg-zinc-900 dark:bg-white text-white dark:text-zinc-900"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    Concepto
                  </button>
                  <button
                    onClick={() => setAgrupacionCompras("proveedor")}
                    aria-pressed={agrupacionCompras === "proveedor"}
                    className={cn(
                      "h-7 px-2.5 rounded-md text-xs font-medium transition-all inline-flex items-center gap-1",
                      agrupacionCompras === "proveedor"
                        ? "bg-zinc-900 dark:bg-white text-white dark:text-zinc-900"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Users className="w-3 h-3" />
                    Proveedor
                  </button>
                </div>
              </th>
              {months.map((idx) => (
                <th key={idx} className="sticky top-0 z-20 bg-muted text-right px-3 py-3 font-medium min-w-[90px] whitespace-nowrap">
                  <button
                    onClick={() => handleSortClick(idx)}
                    className={cn(
                      "inline-flex items-center gap-1 ml-auto hover:text-foreground transition-colors",
                      sortCol === idx ? "text-foreground" : "text-muted-foreground"
                    )}
                  >
                    {MONTHS[idx - 1]}
                    {sortCol === idx ? (
                      sortDir === "desc" ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />
                    ) : (
                      sortDir === "desc" ? <ChevronDown className="w-3 h-3 opacity-40" /> : <ChevronUp className="w-3 h-3 opacity-40" />
                    )}
                  </button>
                </th>
              ))}
              <th className="sticky top-0 z-20 bg-muted text-right px-4 py-3 font-semibold text-[15px] min-w-[110px] whitespace-nowrap">
                <button
                  onClick={() => handleSortClick("total")}
                  className={cn(
                    "inline-flex items-center gap-1 ml-auto hover:text-foreground transition-colors",
                    sortCol === "total" ? "text-foreground" : "text-muted-foreground"
                  )}
                >
                  Total
                  {sortCol === "total" ? (
                    sortDir === "desc" ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />
                  ) : (
                    sortDir === "desc" ? <ChevronDown className="w-3 h-3 opacity-40" /> : <ChevronUp className="w-3 h-3 opacity-40" />
                  )}
                </button>
              </th>
              <th
                className="sticky top-0 z-20 bg-muted text-right px-3 py-3 font-medium text-muted-foreground min-w-[64px] whitespace-nowrap cursor-pointer select-none hover:text-foreground transition-colors"
                onClick={() => setPctMode((m) => m === "ingresos" ? "egresos" : "ingresos")}
                title={pctMode === "ingresos" ? "% sobre ingresos — click para cambiar a % sobre egresos" : "% sobre egresos — click para cambiar a % sobre ingresos"}
              >
                % {pctMode === "ingresos" ? "ing" : "egr"}
              </th>
            </tr>
          </thead>

          <tbody>
            {flatRows.map((item) => {
              if (item.type === "rubroTop") {
                const rubro = item.data as PivotRubroRowPorProveedor;
                const isExpanded = expanded.has(rubro.id);
                return (
                  <tr key={rubro.id} className="border-b font-semibold" onContextMenu={collapseAll}>
                    <td className="sticky left-0 z-10 bg-muted px-4 py-2.5 shadow-[1px_0_0_0_hsl(var(--border))]">
                      <ExpandableButton isExpanded={isExpanded} onClick={() => toggleRow(rubro.id)}>
                        {rubro.nombre}
                      </ExpandableButton>
                    </td>
                    {months.map((mes) => (
                      <td
                        key={mes}
                        className={cn(
                          "text-right px-3 py-2.5 tabular-nums bg-muted/25 hover:bg-muted/50 transition-colors",
                          hasValue(rubro.values[mes]) && "cursor-pointer hover:text-primary"
                        )}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (hasValue(rubro.values[mes]))
                            openDetalle({ mes, rubroCodigo: rubro.rubroCodigo });
                        }}
                      >
                        {fmtARS(rubro.values[mes])}
                      </td>
                    ))}
                    <td
                      className="text-right px-4 py-2.5 tabular-nums font-semibold text-[15px] bg-muted/25 hover:bg-muted/50 transition-colors cursor-pointer hover:text-primary"
                      onClick={(e) => {
                        e.stopPropagation();
                        openDetalle({ rubroCodigo: rubro.rubroCodigo });
                      }}
                    >
                      {fmtARS(rubro.rowTotal)}
                    </td>
                    <td className="text-right px-3 py-2.5 tabular-nums text-xs text-muted-foreground/70 whitespace-nowrap bg-muted/25 hover:bg-muted/50 transition-colors">
                      {fmtPct(rubro.rowTotal)}
                    </td>
                  </tr>
                );
              }

              if (item.type === "proveedorSub") {
                const proveedor = item.data as PivotProveedorSubRow;
                const isExpanded = expanded.has(proveedor.id);
                // "Sin Proveedor" no se puede filtrar en /api/dashboard/detalle
                // (no hay forma de pedir "proveedorId IS NULL" ahí) — no ofrecer
                // un drill-down que traería todas las compras sin filtrar.
                const puedeDrillDown = proveedor.proveedorId != null;
                return (
                  <tr key={proveedor.id} className="border-b font-semibold" onContextMenu={collapseProveedores}>
                    <td className="sticky left-0 z-10 bg-muted px-4 py-2.5 shadow-[1px_0_0_0_hsl(var(--border))]">
                      <div className="flex items-center gap-1">
                        <ExpandableButton
                          isExpanded={isExpanded}
                          onClick={() => toggleRow(proveedor.id)}
                          indent="pl-5"
                          iconSize="w-3.5 h-3.5"
                          className="flex-1 min-w-0"
                        >
                          {normalize(proveedor.nombre)}
                        </ExpandableButton>
                        {localId != null && proveedor.proveedorId != null && (
                          <button
                            type="button"
                            title="Apertura de gastos"
                            onClick={(e) => {
                              e.stopPropagation();
                              setApertura({
                                nivel: "proveedor",
                                entidadId: String(proveedor.proveedorId),
                                entidadNombre: normalize(proveedor.nombre),
                                origenLocalId: localId ?? null,
                                origenPdvId: pdvId ?? null,
                              });
                            }}
                            className={cn(
                              "shrink-0 flex h-5 w-5 items-center justify-center rounded hover:bg-muted transition-colors",
                              reglasActivasPorNivel.proveedor.has(String(proveedor.proveedorId))
                                ? "text-primary"
                                : "text-muted-foreground/40 hover:text-muted-foreground"
                            )}
                          >
                            <Split className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </td>
                    {months.map((mes) => (
                      <td
                        key={mes}
                        className={cn(
                          "text-right px-3 py-2.5 tabular-nums bg-muted/25 hover:bg-muted/50 transition-colors",
                          puedeDrillDown && hasValue(proveedor.values[mes]) && "cursor-pointer hover:text-primary"
                        )}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (puedeDrillDown && hasValue(proveedor.values[mes]))
                            openDetalle({ mes, proveedorId: proveedor.proveedorId! });
                        }}
                      >
                        {fmtARS(proveedor.values[mes])}
                      </td>
                    ))}
                    <td
                      className={cn(
                        "text-right px-4 py-2.5 tabular-nums font-semibold text-[15px] bg-muted/25 hover:bg-muted/50 transition-colors",
                        puedeDrillDown && "cursor-pointer hover:text-primary"
                      )}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (puedeDrillDown) openDetalle({ proveedorId: proveedor.proveedorId! });
                      }}
                    >
                      {fmtARS(proveedor.rowTotal)}
                    </td>
                    <td className="text-right px-3 py-2.5 tabular-nums text-xs text-muted-foreground/70 whitespace-nowrap bg-muted/25 hover:bg-muted/50 transition-colors">
                      {fmtPct(proveedor.rowTotal)}
                    </td>
                  </tr>
                );
              }

              if (item.type === "conceptoSub") {
                const concepto = item.data as PivotConceptoSubRow;
                const isExpanded = expanded.has(concepto.id);
                // Sin proveedor vinculado no se puede armar el filtro {proveedorId, conceptoCodigo}
                // que este drill-down necesita — mismo criterio que puedeDrillDown en la fila de proveedor.
                const puedeDrillDownConcepto = concepto.proveedorId != null;
                return (
                  <tr key={concepto.id} className="border-b hover:bg-accent/40 transition-colors" onContextMenu={collapseConceptos}>
                    <td className="sticky left-0 z-10 bg-background px-4 py-2 shadow-[1px_0_0_0_hsl(var(--border))]">
                      <div className="flex items-center gap-1">
                        <ExpandableButton
                          isExpanded={isExpanded}
                          onClick={() => toggleRow(concepto.id)}
                          indent="pl-9"
                          iconSize="w-3 h-3"
                          className="flex-1 min-w-0"
                        >
                          {concepto.nombre}
                        </ExpandableButton>
                        {localId != null && (
                          <button
                            type="button"
                            title="Apertura de gastos"
                            onClick={(e) => {
                              e.stopPropagation();
                              setApertura({
                                nivel: "concepto",
                                entidadId: concepto.conceptoCodigo,
                                entidadNombre: concepto.nombre,
                                origenLocalId: localId ?? null,
                                origenPdvId: pdvId ?? null,
                              });
                            }}
                            className={cn(
                              "shrink-0 flex h-5 w-5 items-center justify-center rounded hover:bg-muted transition-colors",
                              reglasActivasPorNivel.concepto.has(concepto.conceptoCodigo)
                                ? "text-primary"
                                : "text-muted-foreground/40 hover:text-muted-foreground"
                            )}
                          >
                            <Split className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </td>
                    {months.map((mes) => {
                      const comp = concepto.composicion?.[mes];
                      const cell = (
                        <td
                          key={mes}
                          className={cn(
                            "text-right px-3 py-2 tabular-nums text-muted-foreground",
                            puedeDrillDownConcepto && hasValue(concepto.values[mes]) && "cursor-pointer hover:text-foreground"
                          )}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (puedeDrillDownConcepto && hasValue(concepto.values[mes]))
                              openDetalle({ mes, conceptoCodigo: concepto.conceptoCodigo, proveedorId: concepto.proveedorId! });
                          }}
                        >
                          {fmtARS(concepto.values[mes])}
                        </td>
                      );
                      if (!comp) return cell;
                      return (
                        <Tooltip key={mes}>
                          <TooltipTrigger asChild>{cell}</TooltipTrigger>
                          <TooltipContent className="text-xs">
                            <div className="font-medium">100% · {fmtARS(comp.total)}</div>
                            {comp.destinos.map((d, i) => (
                              <div key={i} className="text-background/70">
                                {d.pct}% {d.nombre} {fmtARS(d.importe)}
                              </div>
                            ))}
                          </TooltipContent>
                        </Tooltip>
                      );
                    })}
                    <td
                      className={cn(
                        "text-right px-4 py-2 tabular-nums text-muted-foreground font-semibold text-sm",
                        puedeDrillDownConcepto && "cursor-pointer hover:text-foreground"
                      )}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (puedeDrillDownConcepto)
                          openDetalle({ conceptoCodigo: concepto.conceptoCodigo, proveedorId: concepto.proveedorId! });
                      }}
                    >
                      {fmtARS(concepto.rowTotal)}
                    </td>
                    <td className="text-right px-3 py-2 tabular-nums text-xs text-muted-foreground/50 whitespace-nowrap">
                      {fmtPct(concepto.rowTotal)}
                    </td>
                  </tr>
                );
              }

              const linea = item.data;
              const labelParts = [
                linea.fecha ? `${linea.fecha.slice(8, 10)}/${linea.fecha.slice(5, 7)}` : null,
                linea.observac || null,
                fmtARS(linea.importe),
              ].filter(Boolean);
              const labelLinea = labelParts.join(' · ');
              const tieneReglaRegistro = reglasActivasPorNivel.registro.has(linea.rowId);
              return (
                <tr
                  key={linea.id}
                  className={cn(
                    "group border-b transition-colors",
                    linea.hasManualOverride ? "bg-attention/5 hover:bg-attention/10" : "hover:bg-accent/20"
                  )}
                >
                  <td className={cn("sticky left-0 z-10 bg-background px-4 py-1.5 pl-[4.5rem] text-xs shadow-[1px_0_0_0_hsl(var(--border))]", linea.hasManualOverride ? "text-attention" : "text-muted-foreground")}>
                    <span className="flex items-center gap-1.5">
                      {linea.hasManualOverride && <EditedDot />}
                      {labelLinea}
                      {localId != null && (
                        <button
                          type="button"
                          title="Apertura de gastos"
                          onClick={(e) => {
                            e.stopPropagation();
                            setApertura({
                              nivel: "registro",
                              entidadId: linea.rowId,
                              entidadNombre: labelLinea,
                              origenLocalId: linea.localIdOrigen,
                              origenPdvId: linea.puntoDeVentaIdOrigen,
                            });
                          }}
                          className={cn(
                            "shrink-0 flex h-4 w-4 items-center justify-center rounded hover:bg-muted transition-opacity focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                            tieneReglaRegistro
                              ? "text-primary opacity-100"
                              : "text-muted-foreground/40 hover:text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                          )}
                        >
                          <Split className="w-2.5 h-2.5" />
                        </button>
                      )}
                    </span>
                  </td>
                  {months.map((mes) => (
                    <td
                      key={mes}
                      className={cn(
                        "text-right px-3 py-1.5 tabular-nums text-muted-foreground text-xs",
                        hasValue(linea.values[mes]) && "cursor-pointer hover:text-foreground"
                      )}
                      onClick={() => {
                        if (hasValue(linea.values[mes]))
                          openDetalle({ rowId: linea.rowId, distribucionId: linea.distribucionId ?? undefined });
                      }}
                    >
                      {fmtARS(linea.values[mes])}
                    </td>
                  ))}
                  <td
                    className="text-right px-4 py-1.5 tabular-nums text-muted-foreground text-xs cursor-pointer hover:text-foreground"
                    onClick={() => openDetalle({ rowId: linea.rowId, distribucionId: linea.distribucionId ?? undefined })}
                  >
                    {fmtARS(linea.rowTotal)}
                  </td>
                  <td className="text-right px-3 py-1.5 tabular-nums text-xs text-muted-foreground/40 whitespace-nowrap">
                    {fmtPct(linea.rowTotal)}
                  </td>
                </tr>
              );
            })}
          </tbody>

          <tfoot>
            <tr className="border-t-2 bg-muted font-semibold text-[15px]">
              <td className="sticky left-0 z-10 bg-muted px-4 py-3 shadow-[1px_0_0_0_hsl(var(--border))]">
                Total {year}
              </td>
              {months.map((mes) => (
                <td key={mes} className="text-right px-3 py-3 tabular-nums bg-muted">
                  {fmtARS(data.columnTotals[mes])}
                </td>
              ))}
              <td className="text-right px-4 py-3 tabular-nums text-primary bg-muted">
                {fmtARS(data.grandTotal)}
              </td>
              <td className="text-right px-3 py-3 tabular-nums text-xs text-muted-foreground/70 whitespace-nowrap font-semibold bg-muted">
                {pctMode === "egresos" ? "—" : fmtPct(data.grandTotal)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <ComprasDetalleModal filter={detalleFilter} onClose={() => setDetalleFilter(null)} />
      <VentasDetalleModal filter={ventasDetalleFilter} onClose={() => setVentasDetalleFilter(null)} />

      <AperturaGastosModal
        nivel={apertura?.nivel ?? "concepto"}
        entidadId={apertura?.entidadId ?? null}
        entidadNombre={apertura?.entidadNombre ?? ""}
        origenLocalId={apertura?.origenLocalId ?? null}
        origenPdvId={apertura?.origenPdvId ?? null}
        onClose={() => setApertura(null)}
      />
    </>
  );
}
```

- [ ] **Step 2: Correr todos los tests unitarios**

Run: `npx vitest run`
Expected: PASS en todo el suite (Task 1 y 2 ya verificadas individualmente; esto confirma que no rompió nada en la vista "por Concepto" ni en otras pantallas).

- [ ] **Step 3: Correr el linter**

Run: `npm run lint`
Expected: sin errores.

- [ ] **Step 4: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/pivot-table-por-proveedor.tsx
git commit -m "feat(dashboard): renderiza el nivel Rubro en la vista de Compras por Proveedor"
```

---

## Task 5: Build y verificación manual contra datos reales

**Files:** ninguno (solo comandos y verificación manual).

- [ ] **Step 1: Build de producción**

Run: `npm run build`
Expected: build exitoso (corre `prisma generate` antes, sin cambios de schema esperados).

- [ ] **Step 2: Levantar el dev server y verificar manualmente**

Run: `npm run dev`

Checklist manual en el navegador, pantalla Compras, toggle "Ver por: Proveedor":
- El nivel superior ahora son Rubros; expandir uno muestra Proveedores; expandir un Proveedor muestra Conceptos; expandir un Concepto muestra líneas de compra individuales.
- Un proveedor con compras en más de un rubro aparece una vez bajo cada rubro correspondiente, con totales que no se mezclan entre sí.
- Los totales de cada Rubro coinciden con la suma de sus Proveedores; el total general de la vista coincide con el que mostraba antes del cambio (mismo dato, reagrupado).
- El ícono Aperturar (Split) sigue apareciendo en las filas de Proveedor y de Concepto, con el mismo comportamiento que antes (abre el modal con el nivel/entidad correctos, se colorea si hay una regla activa).
- Click derecho en una fila de Rubro colapsa todo el árbol; click derecho en una fila de Proveedor colapsa Proveedor+Concepto+línea manteniendo el Rubro expandido; click derecho en una fila de Concepto colapsa Concepto+línea manteniendo Rubro y Proveedor expandidos.
- Click en una celda o el total de una fila de Rubro abre el modal de detalle filtrado por ese rubro; ídem para Proveedor y Concepto con sus filtros correspondientes.
- La vista "Ver por: Concepto" (el otro toggle) se ve y comporta exactamente igual que antes del cambio.

- [ ] **Step 3: Confirmar con el usuario**

Reportar el resultado de la verificación manual antes de dar la tarea por cerrada (sección 7 de CLAUDE.md — cambios que tocan cómo se muestran datos de compras se confirman con el usuario).
