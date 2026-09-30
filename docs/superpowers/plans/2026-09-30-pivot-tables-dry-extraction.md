# Pivot Tables DRY Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the verified 100%-identical duplication between `pivot-table-por-concepto.tsx` and `pivot-table-por-proveedor.tsx` (thead, tfoot, top rubro row, composition tooltip, pctMode logic, detail modals + apertura state) by extracting it into shared components/hooks, without touching the middle row tree (concepto/proveedor/registro), which stays distinct in each file because it has real, non-duplicated logic.

**Architecture:** Six new small, single-responsibility files (5 presentational components + 1 hook with a pure helper function) get created first, each independently reviewable. The two existing pivot table files are then each modified in a single task to consume all six, replacing identical inline JSX/state with calls to the shared pieces.

**Tech Stack:** Next.js 16 + React 19 + TypeScript, Tailwind CSS classes (copied verbatim from existing JSX, no style changes), Vitest for the one pure function that's genuinely testable.

**Spec:** `docs/superpowers/specs/2026-09-30-pivot-tables-dry-extraction-design.md`

## Global Constraints

- No visible behavior changes except the one agreed fix: the composition tooltip's percentage rounds with `Math.round` in both views (today `pivot-table-por-concepto.tsx`'s inline tooltip does not round; `pivot-table-por-proveedor.tsx`'s does — see spec).
- Do NOT merge `PivotTableByConcepto` and `PivotTableByProveedor` into one generic component — the middle row tree (concepto/proveedor/registro) stays in each file.
- No React component-testing infrastructure exists in this project (confirmed in earlier blocks of this same effort) — new presentational components are verified via `npx tsc --noEmit`, `npm run lint`, and `npm run build` only. The one exception is `computePctLabel` (a pure function), which gets a real Vitest test.
- Every new file gets one clear responsibility (CLAUDE.md §1, SRP).
- Run `npm test -- --run`, `npm run lint`, `npx tsc --noEmit`, and `npm run build` after each task; none may regress.

---

### Task 1: `usePctMode` hook + `computePctLabel` pure function

**Files:**
- Create: `hooks/use-pct-mode.ts`
- Test: `hooks/use-pct-mode.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  - `export function computePctLabel(rowTotal: number, denominator: number, isLoadingIngresos: boolean): string`
  - `export function usePctMode(grandTotal: number, ingresosTotal: number | undefined, ventasLoading: boolean): { pctMode: "ingresos" | "egresos"; togglePctMode: () => void; fmtPct: (rowTotal: number) => string }`
  - Tasks 7 and 8 import `usePctMode` from `@/hooks/use-pct-mode`.

- [ ] **Step 1: Write the failing tests**

```typescript
// hooks/use-pct-mode.test.ts
import { describe, it, expect } from "vitest";
import { computePctLabel } from "./use-pct-mode";

describe("computePctLabel", () => {
  it("denominador 0: devuelve guion, sin dividir por cero", () => {
    expect(computePctLabel(500, 0, false)).toBe("—");
  });

  it("denominador positivo: devuelve porcentaje con 1 decimal", () => {
    expect(computePctLabel(50, 200, false)).toBe("25.0%");
  });

  it("isLoadingIngresos=true: devuelve el indicador de carga sin importar el resto", () => {
    expect(computePctLabel(50, 200, true)).toBe("…");
  });

  it("rowTotal 0 con denominador positivo: 0.0%, no guion", () => {
    expect(computePctLabel(0, 200, false)).toBe("0.0%");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run hooks/use-pct-mode.test.ts`
Expected: FAIL — `hooks/use-pct-mode.ts` does not exist yet (`Cannot find module './use-pct-mode'`).

- [ ] **Step 3: Write the implementation**

```typescript
// hooks/use-pct-mode.ts
"use client";
import { useState } from "react";

// Separada de usePctMode para poder testearla directo con Vitest — no hay
// infraestructura de test de hooks de React en este proyecto.
export function computePctLabel(
  rowTotal: number,
  denominator: number,
  isLoadingIngresos: boolean
): string {
  if (isLoadingIngresos) return "…";
  return denominator > 0 ? `${((rowTotal / denominator) * 100).toFixed(1)}%` : "—";
}

// Reemplaza el useState<"ingresos"|"egresos"> + pctDenominator + fmtPct
// duplicados byte a byte en pivot-table-por-concepto.tsx y
// pivot-table-por-proveedor.tsx.
export function usePctMode(
  grandTotal: number,
  ingresosTotal: number | undefined,
  ventasLoading: boolean
) {
  const [pctMode, setPctMode] = useState<"ingresos" | "egresos">("ingresos");
  const pctDenominator = pctMode === "ingresos" ? (ingresosTotal ?? 0) : grandTotal;
  const fmtPct = (rowTotal: number) =>
    computePctLabel(rowTotal, pctDenominator, pctMode === "ingresos" && ventasLoading);
  const togglePctMode = () => setPctMode((m) => (m === "ingresos" ? "egresos" : "ingresos"));
  return { pctMode, togglePctMode, fmtPct };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run hooks/use-pct-mode.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Verify types and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add hooks/use-pct-mode.ts hooks/use-pct-mode.test.ts
git commit -m "feat(dashboard): extrae usePctMode/computePctLabel para pivot tables"
```

---

### Task 2: `PivotDetailModals` + `AperturaModalState` + `useAperturaModalState`

**Files:**
- Create: `components/dashboard/pivot-detail-modals.tsx`

**Interfaces:**
- Consumes: `ComprasDetalleModal` (`./compras-detalle-modal`), `VentasDetalleModal` (`./ventas-detalle-modal`), `AperturaGastosModal` (`./apertura-gastos-modal`), `NivelRegla` (`@/lib/apertura/schemas`), `DetalleFilter`/`VentasDetalleFilter` (`@/lib/dashboard/types`) — all pre-existing, unmodified by this plan.
- Produces:
  - `export interface AperturaModalState { nivel: NivelRegla; entidadId: string; entidadNombre: string; origenLocalId: number | null; origenPdvId: number | null; }`
  - `export function useAperturaModalState(): [AperturaModalState | null, React.Dispatch<React.SetStateAction<AperturaModalState | null>>]`
  - `export function PivotDetailModals(props: PivotDetailModalsProps): JSX.Element`
  - Tasks 7 and 8 import both from `./pivot-detail-modals`.

- [ ] **Step 1: Write the component**

```typescript
// components/dashboard/pivot-detail-modals.tsx
"use client";
import { useState } from "react";
import { ComprasDetalleModal } from "./compras-detalle-modal";
import { VentasDetalleModal } from "./ventas-detalle-modal";
import { AperturaGastosModal } from "./apertura-gastos-modal";
import type { NivelRegla } from "@/lib/apertura/schemas";
import type { DetalleFilter, VentasDetalleFilter } from "@/lib/dashboard/types";

// Estado del modal de apertura — idéntico en pivot-table-por-concepto.tsx y
// pivot-table-por-proveedor.tsx antes de esta extracción.
export interface AperturaModalState {
  nivel: NivelRegla;
  entidadId: string;
  entidadNombre: string;
  origenLocalId: number | null;
  origenPdvId: number | null;
}

export function useAperturaModalState() {
  return useState<AperturaModalState | null>(null);
}

interface PivotDetailModalsProps {
  detalleFilter: DetalleFilter | null;
  onCloseDetalle: () => void;
  ventasDetalleFilter: VentasDetalleFilter | null;
  onCloseVentasDetalle: () => void;
  apertura: AperturaModalState | null;
  onCloseApertura: () => void;
}

// Los 3 modales de drill-down/apertura de la tabla pivot de compras — idénticos
// byte a byte entre pivot-table-por-concepto.tsx y pivot-table-por-proveedor.tsx
// antes de esta extracción.
export function PivotDetailModals({
  detalleFilter,
  onCloseDetalle,
  ventasDetalleFilter,
  onCloseVentasDetalle,
  apertura,
  onCloseApertura,
}: PivotDetailModalsProps) {
  return (
    <>
      <ComprasDetalleModal filter={detalleFilter} onClose={onCloseDetalle} />
      <VentasDetalleModal filter={ventasDetalleFilter} onClose={onCloseVentasDetalle} />
      <AperturaGastosModal
        nivel={apertura?.nivel ?? "concepto"}
        entidadId={apertura?.entidadId ?? null}
        entidadNombre={apertura?.entidadNombre ?? ""}
        origenLocalId={apertura?.origenLocalId ?? null}
        origenPdvId={apertura?.origenPdvId ?? null}
        onClose={onCloseApertura}
      />
    </>
  );
}
```

- [ ] **Step 2: Verify types and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors (this file isn't wired into anything yet, so it must type-check standalone)

- [ ] **Step 3: Commit**

```bash
git add components/dashboard/pivot-detail-modals.tsx
git commit -m "feat(dashboard): extrae PivotDetailModals/useAperturaModalState para pivot tables"
```

---

### Task 3: `ComposicionTooltip` shared component (con fix de redondeo)

**Files:**
- Create: `components/dashboard/composicion-tooltip.tsx`

**Interfaces:**
- Consumes: `Tooltip`/`TooltipContent`/`TooltipTrigger` (`@/components/ui/tooltip`), `fmtARS` (`@/lib/utils`), `ComposicionMes` (`@/lib/dashboard/types`) — all pre-existing.
- Produces: `export function ComposicionTooltip({ comp, children }: { comp: ComposicionMes | undefined; children: React.ReactElement }): React.ReactElement`. Tasks 7 and 8 import it from `./composicion-tooltip`.

- [ ] **Step 1: Write the component**

```typescript
// components/dashboard/composicion-tooltip.tsx
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fmtARS } from "@/lib/utils";
import type { ComposicionMes } from "@/lib/dashboard/types";

// Envuelve una celda con el tooltip de prorrateo cuando hay composicion para
// esa celda (mes puntual o total anual, de concepto o de proveedor agregado)
// — sin composicion, devuelve la celda tal cual, sin tooltip. Antes de esta
// extracción vivía solo en pivot-table-por-proveedor.tsx; la vista concepto
// tenía una copia inline que NO redondeaba el %, a diferencia de esta — ver
// spec 2026-09-30 sobre por qué se unifica con Math.round.
export function ComposicionTooltip({
  comp,
  children,
}: {
  comp: ComposicionMes | undefined;
  children: React.ReactElement;
}) {
  if (!comp) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent className="text-xs">
        {/* TooltipContent es inline-flex (fila) por defecto — envolver en
            flex-col para que el detalle se lea de arriba a abajo en vez de
            romperse a mitad de palabra cuando hay 2+ destinos. */}
        <div className="flex flex-col items-start gap-0.5">
          <div className="font-medium">100% · {fmtARS(comp.total)}</div>
          {comp.destinos.map((d, i) => (
            <div key={i} className="text-background/70">
              {Math.round(d.pct)}% {d.nombre} {fmtARS(d.importe)}
            </div>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
```

- [ ] **Step 2: Verify types and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add components/dashboard/composicion-tooltip.tsx
git commit -m "feat(dashboard): extrae ComposicionTooltip compartido para pivot tables"
```

---

### Task 4: `PivotTableHead` shared component

**Files:**
- Create: `components/dashboard/pivot-table-head.tsx`

**Interfaces:**
- Consumes: `KpiBlock` (`./kpi-block`), `cn` (`@/lib/utils`), `MONTHS` (`@/lib/dashboard/constants`), `ChevronDown`/`ChevronUp`/`Users` (`lucide-react`), `SortCol`/`SortDir` (`@/lib/dashboard/pivot-utils`), `AgrupacionCompras` (`@/lib/dashboard/params`) — all pre-existing.
- Produces: `export function PivotTableHead(props: PivotTableHeadProps): JSX.Element`, rendering a `<thead>` element (must be used directly inside a `<table>`, same as the JSX it replaces). Tasks 7 and 8 import it from `./pivot-table-head`.

- [ ] **Step 1: Write the component**

```typescript
// components/dashboard/pivot-table-head.tsx
import { ChevronDown, ChevronUp, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { MONTHS } from "@/lib/dashboard/constants";
import { KpiBlock } from "./kpi-block";
import type { SortCol, SortDir } from "@/lib/dashboard/pivot-utils";
import type { AgrupacionCompras } from "@/lib/dashboard/params";

interface PivotTableHeadProps {
  months: number[];
  sortCol: SortCol;
  sortDir: SortDir;
  onSortClick: (col: SortCol) => void;
  agrupacionCompras: AgrupacionCompras;
  onAgrupacionChange: (a: AgrupacionCompras) => void;
  pctMode: "ingresos" | "egresos";
  onTogglePctMode: () => void;
  ingresosPorMes: Record<number, number>;
  egresosPorMes: Record<number, number>;
  ingresosTotal: number | undefined;
  egresosTotal: number;
  ingresosReady: boolean;
  onIngresoCellClick: (mes: number) => void;
  onIngresoTotalClick: () => void;
}

// <thead> completo de la tabla pivot de compras (KpiBlock + fila de toggle
// Concepto/Proveedor + headers de mes/Total/%) — idéntico byte a byte entre
// pivot-table-por-concepto.tsx y pivot-table-por-proveedor.tsx antes de esta
// extracción.
export function PivotTableHead({
  months,
  sortCol,
  sortDir,
  onSortClick,
  agrupacionCompras,
  onAgrupacionChange,
  pctMode,
  onTogglePctMode,
  ingresosPorMes,
  egresosPorMes,
  ingresosTotal,
  egresosTotal,
  ingresosReady,
  onIngresoCellClick,
  onIngresoTotalClick,
}: PivotTableHeadProps) {
  return (
    <thead>
      <KpiBlock
        months={months}
        ingresosPorMes={ingresosPorMes}
        egresosPorMes={egresosPorMes}
        ingresosTotal={ingresosTotal}
        egresosTotal={egresosTotal}
        ingresosReady={ingresosReady}
        variant="borderless"
        onIngresoCellClick={onIngresoCellClick}
        onIngresoTotalClick={onIngresoTotalClick}
      />
      <tr className="bg-muted border-b">
        <th className="sticky left-0 top-0 z-30 bg-muted text-left px-4 py-3 font-medium text-muted-foreground min-w-[240px] whitespace-nowrap shadow-[1px_0_0_0_hsl(var(--border))]">
          <div className="flex items-center gap-1 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 p-0.5 w-fit">
            <button
              onClick={() => onAgrupacionChange("concepto")}
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
              onClick={() => onAgrupacionChange("proveedor")}
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
          <th
            key={idx}
            className="sticky top-0 z-20 bg-muted text-right px-3 py-3 font-medium min-w-[90px] whitespace-nowrap"
          >
            <button
              onClick={() => onSortClick(idx)}
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
            onClick={() => onSortClick("total")}
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
          onClick={onTogglePctMode}
          title={pctMode === "ingresos" ? "% sobre ingresos — click para cambiar a % sobre egresos" : "% sobre egresos — click para cambiar a % sobre ingresos"}
        >
          % {pctMode === "ingresos" ? "ing" : "egr"}
        </th>
      </tr>
    </thead>
  );
}
```

- [ ] **Step 2: Verify types and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add components/dashboard/pivot-table-head.tsx
git commit -m "feat(dashboard): extrae PivotTableHead compartido para pivot tables"
```

---

### Task 5: `PivotTableFoot` shared component

**Files:**
- Create: `components/dashboard/pivot-table-foot.tsx`

**Interfaces:**
- Consumes: `fmtARS` (`@/lib/utils`) — pre-existing.
- Produces: `export function PivotTableFoot(props: PivotTableFootProps): JSX.Element`, rendering a `<tfoot>` element (must be used directly inside a `<table>`). Tasks 7 and 8 import it from `./pivot-table-foot`.

- [ ] **Step 1: Write the component**

```typescript
// components/dashboard/pivot-table-foot.tsx
import { fmtARS } from "@/lib/utils";

interface PivotTableFootProps {
  year: number;
  months: number[];
  columnTotals: Record<number, number>;
  grandTotal: number;
  pctMode: "ingresos" | "egresos";
  fmtPct: (rowTotal: number) => string;
}

// <tfoot> completo de la tabla pivot de compras — idéntico byte a byte entre
// pivot-table-por-concepto.tsx y pivot-table-por-proveedor.tsx antes de esta
// extracción.
export function PivotTableFoot({ year, months, columnTotals, grandTotal, pctMode, fmtPct }: PivotTableFootProps) {
  return (
    <tfoot>
      <tr className="border-t-2 bg-muted font-semibold text-[15px]">
        <td className="sticky left-0 z-10 bg-muted px-4 py-3 shadow-[1px_0_0_0_hsl(var(--border))]">
          Total {year}
        </td>
        {months.map((mes) => (
          <td key={mes} className="text-right px-3 py-3 tabular-nums bg-muted">
            {fmtARS(columnTotals[mes])}
          </td>
        ))}
        <td className="text-right px-4 py-3 tabular-nums text-primary bg-muted">
          {fmtARS(grandTotal)}
        </td>
        <td className="text-right px-3 py-3 tabular-nums text-xs text-muted-foreground/70 whitespace-nowrap font-semibold bg-muted">
          {pctMode === "egresos" ? "—" : fmtPct(grandTotal)}
        </td>
      </tr>
    </tfoot>
  );
}
```

- [ ] **Step 2: Verify types and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add components/dashboard/pivot-table-foot.tsx
git commit -m "feat(dashboard): extrae PivotTableFoot compartido para pivot tables"
```

---

### Task 6: `RubroRow` shared component

**Files:**
- Create: `components/dashboard/pivot-rubro-row.tsx`

**Interfaces:**
- Consumes: `ExpandableButton` (`@/components/ui/expandable-button`), `cn`/`fmtARS` (`@/lib/utils`), `hasValue` (`@/lib/dashboard/pivot-utils`) — all pre-existing.
- Produces: `export function RubroRow(props: RubroRowProps): JSX.Element`, rendering a `<tr>` (caller sets `key` on the `<RubroRow>` element itself). `RubroRowProps.rubro` accepts the minimal structural shape `RubroRowData` — both `PivotRubroRow` and `PivotRubroRowPorProveedor` (from `@/lib/dashboard/types`) satisfy it structurally, so callers pass either without casting. Tasks 7 and 8 import `RubroRow` from `./pivot-rubro-row`.

- [ ] **Step 1: Write the component**

```typescript
// components/dashboard/pivot-rubro-row.tsx
import { ExpandableButton } from "@/components/ui/expandable-button";
import { cn, fmtARS } from "@/lib/utils";
import { hasValue } from "@/lib/dashboard/pivot-utils";

// Subconjunto estructural de PivotRubroRow / PivotRubroRowPorProveedor
// (@/lib/dashboard/types) — ambos son compatibles con esto sin cast, ya que
// esta fila no toca `children`.
interface RubroRowData {
  id: string;
  nombre: string;
  rubroCodigo: string;
  values: Record<number, number>;
  rowTotal: number;
}

interface RubroRowProps {
  rubro: RubroRowData;
  months: number[];
  isExpanded: boolean;
  onToggle: () => void;
  onCollapseAll: (e: React.MouseEvent) => void;
  onCellClick: (mes: number, rubroCodigo: string) => void;
  onTotalClick: (rubroCodigo: string) => void;
  fmtPct: (rowTotal: number) => string;
}

// Fila de nivel superior ("rubro") de la tabla pivot de compras — idéntica
// byte a byte entre pivot-table-por-concepto.tsx y
// pivot-table-por-proveedor.tsx antes de esta extracción. El caller pone
// `key={rubro.id}` en el elemento <RubroRow> al usarlo.
export function RubroRow({ rubro, months, isExpanded, onToggle, onCollapseAll, onCellClick, onTotalClick, fmtPct }: RubroRowProps) {
  return (
    <tr className="border-b font-semibold" onContextMenu={onCollapseAll}>
      <td className="sticky left-0 z-10 bg-muted px-4 py-2.5 shadow-[1px_0_0_0_hsl(var(--border))]">
        <ExpandableButton isExpanded={isExpanded} onClick={onToggle}>
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
            if (hasValue(rubro.values[mes])) onCellClick(mes, rubro.rubroCodigo);
          }}
        >
          {fmtARS(rubro.values[mes])}
        </td>
      ))}
      <td
        className="text-right px-4 py-2.5 tabular-nums font-semibold text-[15px] bg-muted/25 hover:bg-muted/50 transition-colors cursor-pointer hover:text-primary"
        onClick={(e) => {
          e.stopPropagation();
          onTotalClick(rubro.rubroCodigo);
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
```

- [ ] **Step 2: Verify types and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add components/dashboard/pivot-rubro-row.tsx
git commit -m "feat(dashboard): extrae RubroRow compartido para pivot tables"
```

---

### Task 7: Wire `pivot-table-por-concepto.tsx` to the shared pieces

**Files:**
- Modify: `components/dashboard/pivot-table-por-concepto.tsx`

**Interfaces:**
- Consumes: `usePctMode` (Task 1), `PivotDetailModals`/`useAperturaModalState` (Task 2), `ComposicionTooltip` (Task 3), `PivotTableHead` (Task 4), `PivotTableFoot` (Task 5), `RubroRow` (Task 6).
- Produces: nothing new — this is the last consumer of Tasks 1-6 for the concepto view.

**Important — rules of hooks:** `usePctMode` calls `useState` internally, so it's a React hook and cannot be called after a conditional early `return` (the original file computed `fmtPct` as a plain function, not a hook, positioned after the `if (!data...) return <PivotEmpty />;` checks — that's no longer possible once the logic is a hook). Step 3 below moves the `usePctMode` call to before the early returns, passing `data?.grandTotal ?? 0` as a safe fallback for the transient moment before `data` is loaded (the component returns `<PivotLoading />` immediately after anyway, so this fallback value is never actually rendered).

- [ ] **Step 1: Replace the imports block**

In `components/dashboard/pivot-table-por-concepto.tsx`, replace lines 1-23 (from `"use client";` through the blank line after the `AperturaSplitButton` import) with:

```typescript
"use client";
import { useOperacionKpis } from "@/hooks/use-operacion-kpis";
import { usePivotScreenData } from "@/hooks/use-pivot-screen-data";
import { ExpandableButton } from "@/components/ui/expandable-button";
import { cn, fmtARS, normalize } from "@/lib/utils";
import { hasValue } from "@/lib/dashboard/pivot-utils";
import { useDashboard } from "@/hooks/use-dashboard-store";
import { useReglasApertura } from "@/hooks/use-reglas-apertura";
import { useReglasActivasPorNivel } from "@/hooks/use-reglas-activas-por-nivel";
import { usePctMode } from "@/hooks/use-pct-mode";
import { PivotLoading, PivotError, PivotEmpty } from "./pivot-states";
import { PivotTableHead } from "./pivot-table-head";
import { PivotTableFoot } from "./pivot-table-foot";
import { RubroRow } from "./pivot-rubro-row";
import { ComposicionTooltip } from "./composicion-tooltip";
import { PivotDetailModals, useAperturaModalState } from "./pivot-detail-modals";
import { EditedDot, AperturaDot } from "./edit-row-controls";
import type { PivotRubroRow, PivotConceptoRow } from "@/lib/dashboard/types";
import { AperturaSplitButton } from "./apertura-split-button";
```

- [ ] **Step 2: Verify the import block compiles in isolation**

Run: `npx tsc --noEmit 2>&1 | grep pivot-table-por-concepto || echo "no errors in this file yet (rest of file still references old code — expected until Step 3)"`

- [ ] **Step 3: Replace the component setup block (state + early returns + pctMode)**

Replace the block starting at `export function PivotTableByConcepto() {` through the line `const egresosPorMes = data.columnTotals;` (originally lines 25-72) with:

```typescript
export function PivotTableByConcepto() {
  const {
    year, localId, pdvId, rubroCodigo, conceptoCodigo, proveedorId, observacionQuery,
    months, activeMonths, sortCol, sortDir, handleSortClick,
    rubroConfigVersion, agrupacionCompras, setAgrupacionCompras,
  } = useDashboard();

  const [apertura, setApertura] = useAperturaModalState();
  const { reglas } = useReglasApertura();
  // Este árbol solo necesita concepto y registro (no proveedor: acá no hay
  // una fila de proveedor donde mostrar ese ícono, ver PivotTableByProveedor
  // para el nivel proveedor).
  const reglasActivasPorNivel = useReglasActivasPorNivel(reglas, localId, pdvId);

  const { data, isLoading, error, ventasData, ventasLoading } = useOperacionKpis({
    year, localId, pdvId, rubroCodigo, conceptoCodigo, proveedorId, observacionQuery,
    months, activeMonths, configVersion: rubroConfigVersion,
  });

  const {
    expanded, toggleRow, collapseAll, collapseConceptos,
    flatRows, detalleFilter, setDetalleFilter, ventasDetalleFilter, setVentasDetalleFilter, openDetalle,
  } = usePivotScreenData({
    data, year, localId, pdvId, sortCol, sortDir, conceptoCodigo, proveedorId, observacionQuery,
  });

  // usePctMode llama a useState internamente — tiene que ejecutarse antes de
  // cualquier return condicional (reglas de hooks). data?.grandTotal ?? 0 es
  // un fallback seguro para el instante antes de que `data` cargue: el
  // return de <PivotLoading /> de abajo hace que ese valor nunca se llegue
  // a renderizar.
  const { pctMode, togglePctMode, fmtPct } = usePctMode(
    data?.grandTotal ?? 0,
    ventasData?.grandTotal,
    ventasLoading
  );

  if (isLoading) return <PivotLoading />;
  if (error) return <PivotError />;
  if (!data || data.rows.length === 0) return <PivotEmpty />;

  const ingresosPorMes = ventasData?.columnTotals ?? {};
  const egresosPorMes = data.columnTotals;
```

- [ ] **Step 4: Replace the `<thead>` block with `<PivotTableHead>`**

Replace the entire `<thead>...</thead>` block (originally lines 78-165) with:

```typescript
          <PivotTableHead
            months={months}
            sortCol={sortCol}
            sortDir={sortDir}
            onSortClick={handleSortClick}
            agrupacionCompras={agrupacionCompras}
            onAgrupacionChange={setAgrupacionCompras}
            pctMode={pctMode}
            onTogglePctMode={togglePctMode}
            ingresosPorMes={ingresosPorMes}
            egresosPorMes={egresosPorMes}
            ingresosTotal={ventasData?.grandTotal}
            egresosTotal={data.grandTotal}
            ingresosReady={!!ventasData}
            onIngresoCellClick={(mes) => setVentasDetalleFilter({ year, localId, pdvId, mes })}
            onIngresoTotalClick={() => setVentasDetalleFilter({ year, localId, pdvId })}
          />
```

- [ ] **Step 5: Replace the `item.type === "rubro"` branch with `<RubroRow>`**

Replace that whole `if (item.type === "rubro") { ... }` block with:

```typescript
              if (item.type === "rubro") {
                const rubro = item.data as PivotRubroRow;
                return (
                  <RubroRow
                    key={rubro.id}
                    rubro={rubro}
                    months={months}
                    isExpanded={expanded.has(rubro.id)}
                    onToggle={() => toggleRow(rubro.id)}
                    onCollapseAll={collapseAll}
                    onCellClick={(mes, rubroCodigo) => openDetalle({ mes, rubroCodigo })}
                    onTotalClick={(rubroCodigo) => openDetalle({ rubroCodigo })}
                    fmtPct={fmtPct}
                  />
                );
              }
```

- [ ] **Step 6: Replace the inline composition-tooltip `months.map` inside the `"concepto"` branch with `<ComposicionTooltip>`**

Replace the `{months.map((mes) => { ... })}` block inside the `item.type === "concepto"` branch (the one using `Tooltip`/`TooltipTrigger`/`TooltipContent` directly) with:

```typescript
                    {months.map((mes) => (
                      <ComposicionTooltip key={mes} comp={concepto.composicion?.[mes]}>
                        <td
                          className={cn(
                            "text-right px-3 py-2 tabular-nums text-muted-foreground",
                            hasValue(concepto.values[mes]) && "cursor-pointer hover:text-foreground"
                          )}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (hasValue(concepto.values[mes]))
                              openDetalle({ mes, conceptoCodigo: concepto.conceptoCodigo });
                          }}
                        >
                          {fmtARS(concepto.values[mes])}
                        </td>
                      </ComposicionTooltip>
                    ))}
```

Note: this is the agreed behavior change — the % in this tooltip now rounds via `Math.round` (same as the proveedor view already did), instead of showing raw decimals.

- [ ] **Step 7: Replace the `<tfoot>` block with `<PivotTableFoot>`**

Replace the entire `<tfoot>...</tfoot>` block with:

```typescript
          <PivotTableFoot
            year={year}
            months={months}
            columnTotals={data.columnTotals}
            grandTotal={data.grandTotal}
            pctMode={pctMode}
            fmtPct={fmtPct}
          />
```

- [ ] **Step 8: Replace the closing modals block with `<PivotDetailModals>`**

Replace the `<ComprasDetalleModal .../>` through `<AperturaGastosModal .../>` block (right before the closing `</>`) with:

```typescript
      <PivotDetailModals
        detalleFilter={detalleFilter}
        onCloseDetalle={() => setDetalleFilter(null)}
        ventasDetalleFilter={ventasDetalleFilter}
        onCloseVentasDetalle={() => setVentasDetalleFilter(null)}
        apertura={apertura}
        onCloseApertura={() => setApertura(null)}
      />
```

- [ ] **Step 9: Verify types, lint, and build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: no errors. The build step specifically catches any leftover reference to a removed import (e.g. `Tooltip`, `KpiBlock`, `MONTHS`, `ChevronDown`) or a prop mismatch.

- [ ] **Step 10: Commit**

```bash
git add components/dashboard/pivot-table-por-concepto.tsx
git commit -m "refactor(dashboard): pivot-table-por-concepto usa las piezas compartidas del pivot"
```

---

### Task 8: Wire `pivot-table-por-proveedor.tsx` to the shared pieces

**Files:**
- Modify: `components/dashboard/pivot-table-por-proveedor.tsx`

**Interfaces:**
- Consumes: `usePctMode` (Task 1), `PivotDetailModals`/`useAperturaModalState` (Task 2), `ComposicionTooltip` (Task 3), `PivotTableHead` (Task 4), `PivotTableFoot` (Task 5), `RubroRow` (Task 6).
- Produces: nothing new — last consumer of Tasks 1-6 for the proveedor view.

Same rules-of-hooks note as Task 7 applies here (`usePctMode` must run before the early returns).

- [ ] **Step 1: Replace the imports block and remove the local `ComposicionTooltip` definition**

Replace everything from `"use client";` through the closing `}` of the local `function ComposicionTooltip(...)` (originally lines 1-48, including the blank line right after) with:

```typescript
"use client";
import { useOperacionKpis } from "@/hooks/use-operacion-kpis";
import { usePivotScreenDataPorProveedor } from "@/hooks/use-pivot-screen-data-por-proveedor";
import { ExpandableButton } from "@/components/ui/expandable-button";
import { cn, fmtARS, normalize } from "@/lib/utils";
import { RUBRO_GASTOS_EN_PERSONAL_CODIGO } from "@/lib/dashboard/constants";
import { hasValue } from "@/lib/dashboard/pivot-utils";
import { useDashboard } from "@/hooks/use-dashboard-store";
import { useReglasApertura } from "@/hooks/use-reglas-apertura";
import { useReglasActivasPorNivel } from "@/hooks/use-reglas-activas-por-nivel";
import { usePctMode } from "@/hooks/use-pct-mode";
import { PivotLoading, PivotError, PivotEmpty } from "./pivot-states";
import { PivotTableHead } from "./pivot-table-head";
import { PivotTableFoot } from "./pivot-table-foot";
import { RubroRow } from "./pivot-rubro-row";
import { ComposicionTooltip } from "./composicion-tooltip";
import { PivotDetailModals, useAperturaModalState } from "./pivot-detail-modals";
import { EditedDot, AperturaDot } from "./edit-row-controls";
import type { PivotDataPorProveedor, PivotRubroRowPorProveedor, PivotProveedorSubRow, PivotConceptoSubRow } from "@/lib/dashboard/types";
import { AperturaSplitButton } from "./apertura-split-button";
import { candidatosEntidadIdProveedor } from "@/lib/proveedor-entidad-id";
```

Note: `ComposicionTooltip` is now imported (Task 3) instead of defined locally — every existing usage in the `proveedorSub` and `conceptoSub` branches (further down in the file) keeps working unchanged, since the imported component has the exact same name and prop signature as the one being removed.

- [ ] **Step 2: Replace the component setup block (state + early returns + pctMode)**

Replace the block starting at `export function PivotTableByProveedor() {` through the line `const egresosPorMes = data.columnTotals;` with:

```typescript
export function PivotTableByProveedor() {
  const {
    year, localId, pdvId, rubroCodigo, conceptoCodigo, proveedorId, observacionQuery,
    months, activeMonths, sortCol, sortDir, handleSortClick,
    rubroConfigVersion, agrupacionCompras, setAgrupacionCompras,
  } = useDashboard();

  const [apertura, setApertura] = useAperturaModalState();
  const { reglas } = useReglasApertura();
  // Reemplaza conceptosConReglaActiva (Fase 1) ahora que hay 3 niveles que
  // pueden mostrar el ícono coloreado.
  const reglasActivasPorNivel = useReglasActivasPorNivel(reglas, localId, pdvId);

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

  // Ver la misma nota en pivot-table-por-concepto.tsx: usePctMode es un hook
  // (useState interno), tiene que ejecutarse antes de cualquier return
  // condicional.
  const { pctMode, togglePctMode, fmtPct } = usePctMode(
    data?.grandTotal ?? 0,
    ventasData?.grandTotal,
    ventasLoading
  );

  if (isLoading) return <PivotLoading />;
  if (error) return <PivotError />;
  if (!data || data.rows.length === 0) return <PivotEmpty />;

  const ingresosPorMes = ventasData?.columnTotals ?? {};
  const egresosPorMes = data.columnTotals;
```

- [ ] **Step 3: Replace the `<thead>` block with `<PivotTableHead>`**

Same replacement as Task 7 Step 4 — the `<thead>...</thead>` block is byte-identical in this file, replace it with the exact same `<PivotTableHead ... />` JSX.

- [ ] **Step 4: Replace the `item.type === "rubroTop"` branch with `<RubroRow>`**

Replace that whole `if (item.type === "rubroTop") { ... }` block with:

```typescript
              if (item.type === "rubroTop") {
                const rubro = item.data as PivotRubroRowPorProveedor;
                return (
                  <RubroRow
                    key={rubro.id}
                    rubro={rubro}
                    months={months}
                    isExpanded={expanded.has(rubro.id)}
                    onToggle={() => toggleRow(rubro.id)}
                    onCollapseAll={collapseAll}
                    onCellClick={(mes, rubroCodigo) => openDetalle({ mes, rubroCodigo })}
                    onTotalClick={(rubroCodigo) => openDetalle({ rubroCodigo })}
                    fmtPct={fmtPct}
                  />
                );
              }
```

- [ ] **Step 5: Replace the `<tfoot>` block with `<PivotTableFoot>`**

Same replacement as Task 7 Step 7 — the `<tfoot>...</tfoot>` block is byte-identical in this file.

- [ ] **Step 6: Replace the closing modals block with `<PivotDetailModals>`**

Same replacement as Task 7 Step 8 — the modals block is byte-identical in this file.

- [ ] **Step 7: Verify types, lint, and build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: no errors.

- [ ] **Step 8: Run the full test suite**

Run: `npm test -- --run`
Expected: all tests pass (no test in the suite touches these two files directly, but this confirms nothing else broke).

- [ ] **Step 9: Commit**

```bash
git add components/dashboard/pivot-table-por-proveedor.tsx
git commit -m "refactor(dashboard): pivot-table-por-proveedor usa las piezas compartidas del pivot"
```
