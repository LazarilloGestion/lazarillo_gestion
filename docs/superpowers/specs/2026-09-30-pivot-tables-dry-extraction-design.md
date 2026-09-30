# Pivot Tables — Extracción de partes compartidas (Bloque 3, Plan B) — Design

## Contexto

`components/dashboard/pivot-table-por-concepto.tsx` (429 líneas) y
`components/dashboard/pivot-table-por-proveedor.tsx` (494 líneas) son las
dos vistas de la tabla pivot de compras del dashboard (toggle
Concepto/Proveedor en la esquina superior izquierda). Ambas muestran el
mismo dato (compras del período filtrado) agrupado distinto: la primera en
3 niveles (rubro → concepto → registro), la segunda en 4 (rubro →
proveedor → concepto → registro).

El review de código de fin de etapa marcó esto como duplicación
(~900 líneas combinadas). Una lectura completa de ambos archivos confirma
que el `<thead>`, el `<tfoot>`, el bloque de 3 modales al final, la fila
de nivel superior ("rubro") y el cálculo de `pctMode`/`fmtPct` son
**100% idénticos** entre los dos archivos — eso es duplicación real,
extraíble sin riesgo. El árbol de filas del medio (concepto/proveedor/
registro) tiene una diferencia estructural genuina — 3 vs 4 niveles, con
lógica propia de cada vista (`candidatosEntidadIdProveedor` para matchear
reglas de apertura a nivel proveedor, caso especial de "Gastos en
Personal") — forzar eso a compartir código violaría KISS/SRP (CLAUDE.md
§1) para ganar poco.

De paso se encontró un bug chico: el tooltip de composición de prorrateo
está duplicado, y las dos copias redondean el porcentaje distinto
(`Math.round(d.pct)` en proveedor, sin redondear en concepto — mismo dato,
dos vistas, dos números). Se decidió unificar con `Math.round` al extraer
el componente compartido.

## Objetivo

Eliminar la duplicación verificada (header, footer, modales, fila de
rubro, tooltip de composición, lógica de `pctMode`) sin tocar el árbol de
filas del medio, que se queda en cada archivo por tener lógica propia real.

## No-objetivos

- No se fusionan los dos componentes en uno solo genérico (Enfoque 2,
  descartado en el brainstorming — ver conversación).
- No se cambia ningún comportamiento visible salvo el fix acordado del
  redondeo del tooltip de composición.
- No se toca `usePivotScreenData`/`usePivotScreenDataPorProveedor` ni los
  hooks de datos (`useOperacionKpis`).
- No se agrega paginación/virtualización (evaluado y descartado en este
  mismo bloque — ver conversación: `flattenRows` ya limita el DOM a lo
  expandido).

## Diseño

### Componentes nuevos

**`components/dashboard/pivot-table-head.tsx`** — `PivotTableHead`: el
`<thead>` completo (KpiBlock + fila de toggle Concepto/Proveedor + headers
de mes/Total/%). Presentacional puro.

```ts
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
```

**`components/dashboard/pivot-table-foot.tsx`** — `PivotTableFoot`: el
`<tfoot>` completo.

```ts
interface PivotTableFootProps {
  year: number;
  months: number[];
  columnTotals: Record<number, number>;
  grandTotal: number;
  pctMode: "ingresos" | "egresos";
  fmtPct: (rowTotal: number) => string;
}
```

**`components/dashboard/pivot-rubro-row.tsx`** — `RubroRow`: la fila de
nivel superior, idéntica en ambas vistas hoy. Tipo estructural mínimo (no
`PivotRubroRow` ni `PivotRubroRowPorProveedor` — ambos son
estructuralmente compatibles con este subconjunto de campos, así que la
misma fila sirve para las dos vistas sin cast):

```ts
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
```

**`components/dashboard/composicion-tooltip.tsx`** — `ComposicionTooltip`,
movido desde `pivot-table-por-proveedor.tsx` sin cambios de props, con
`Math.round(d.pct)` (ya lo tenía). `pivot-table-por-concepto.tsx` deja de
tener su versión inline sin redondear (línea 268-286 actual) y envuelve su
celda de concepto con este componente en su lugar — mismo cambio de
comportamiento que el resto de la vista concepto ya no tiene pero la vista
proveedor sí tenía.

```ts
interface ComposicionTooltipProps {
  comp: ComposicionMes | undefined;
  children: React.ReactElement;
}
```

**`components/dashboard/pivot-detail-modals.tsx`** — `PivotDetailModals`
(los 3 modales) + tipo y hook del estado de apertura, hoy duplicados
idénticos en las dos vistas:

```ts
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
```

### Hook nuevo

**`hooks/use-pct-mode.ts`** — reemplaza el `useState<"ingresos"|"egresos">`
+ `pctDenominator` + `fmtPct` duplicados:

```ts
export function computePctLabel(
  rowTotal: number,
  denominator: number,
  isLoadingIngresos: boolean
): string {
  if (isLoadingIngresos) return "…";
  return denominator > 0 ? `${((rowTotal / denominator) * 100).toFixed(1)}%` : "—";
}

export function usePctMode(grandTotal: number, ingresosTotal: number | undefined, ventasLoading: boolean) {
  const [pctMode, setPctMode] = useState<"ingresos" | "egresos">("ingresos");
  const pctDenominator = pctMode === "ingresos" ? (ingresosTotal ?? 0) : grandTotal;
  const fmtPct = (rowTotal: number) =>
    computePctLabel(rowTotal, pctDenominator, pctMode === "ingresos" && ventasLoading);
  const togglePctMode = () => setPctMode((m) => (m === "ingresos" ? "egresos" : "ingresos"));
  return { pctMode, togglePctMode, fmtPct };
}
```

`computePctLabel` queda separada para poder testearla directo — es la
única lógica no trivial de este refactor.

### Cómo quedan los dos archivos originales

Ambos (`pivot-table-por-concepto.tsx`, `pivot-table-por-proveedor.tsx`)
pasan a: llamar sus hooks de datos propios (sin cambios), usar
`usePctMode`/`useAperturaModalState`, armar su propio árbol de filas medio
(sin cambios de lógica, solo reemplazando la fila de rubro por
`<RubroRow>` y el tooltip inline por `<ComposicionTooltip>` donde
corresponda), y renderizar `<PivotTableHead>` + `<tbody>` propio +
`<PivotTableFoot>` + `<PivotDetailModals>`.

Reducción esperada: ~90 líneas de `<thead>` × 2, ~20 de `<tfoot>` × 2, ~15
de modales × 2, ~40 de fila de rubro × 2, ~20 de tooltip/estado pctMode ×
2 → duplicación eliminada, sin cambiar la forma del árbol de filas medio.

## Manejo de errores

No aplica — son componentes presentacionales puros (reciben datos ya
validados por los hooks de datos existentes) y una función de formato sin
casos de error (siempre devuelve un string).

## Testing

- `hooks/use-pct-mode.test.ts`: `computePctLabel` con denominador 0
  (retorna "—"), denominador positivo (retorna % con 1 decimal),
  `isLoadingIngresos=true` (retorna "…" sin importar el resto).
- Componentes nuevos (`PivotTableHead`, `PivotTableFoot`, `RubroRow`,
  `ComposicionTooltip`, `PivotDetailModals`): sin infraestructura de test
  de componentes React en este proyecto (confirmado en bloques
  anteriores de esta misma etapa) — verificación por tipos/lint/build.
  El riesgo se mitiga extrayendo JSX ya existente sin reescribirlo (copy,
  no reescritura), minimizando la superficie de cambio real.

## Archivos afectados

- Create: `components/dashboard/pivot-table-head.tsx`
- Create: `components/dashboard/pivot-table-foot.tsx`
- Create: `components/dashboard/pivot-rubro-row.tsx`
- Create: `components/dashboard/composicion-tooltip.tsx`
- Create: `components/dashboard/pivot-detail-modals.tsx`
- Create: `hooks/use-pct-mode.ts`, `hooks/use-pct-mode.test.ts`
- Modify: `components/dashboard/pivot-table-por-concepto.tsx`
- Modify: `components/dashboard/pivot-table-por-proveedor.tsx`
