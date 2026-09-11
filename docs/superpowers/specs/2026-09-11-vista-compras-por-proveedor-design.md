# Vista de Compras por Proveedor — Diseño

Fecha: 2026-09-11
Estado: aprobado por el usuario en brainstorming, pendiente de plan de implementación

## 1. Contexto y objetivo

Hoy el pivot de Compras (`PivotTable`) organiza los gastos como `Rubro → Concepto de caja → línea de compra`. El proveedor solo aparece como un dato dentro de la etiqueta de cada línea de compra (nivel hoja), nunca como un nivel de agrupación.

Objetivo: agregar una segunda forma de organizar la misma información, con el **proveedor como eje de navegación** (`Proveedor → Concepto de caja → línea de compra`), para que el usuario pueda explorar sus gastos agrupados por a quién le compra, no solo por en qué concepto los cargó.

Esto es explícitamente la **Fase 1** de un objetivo más grande: la Especificación Apertura de Gastos v2 (ver [[project_apertura_gastos_spec]] y el PDF fuente `Especificacion_Apertura_Gastos_v2.pdf`, sección 2) define un nivel 2 de reglas de apertura ("Proveedor", con prioridad `registro individual > proveedor > concepto`) que hoy está postergado. Esta fase **no implementa reglas nivel-proveedor** — solo prepara la navegación. La fila de proveedor que esta fase introduce como nivel 0 del árbol es, a futuro, el punto de enganche natural para esa Fase 2.

## 2. Alcance

**Incluye:**
- Toggle de agrupación en Compras: "Ver por: Concepto | Proveedor".
- Nuevo árbol de datos `Proveedor → Concepto → línea de compra`, construido a partir de las mismas filas que ya devuelve `/api/dashboard/pivot` (sin queries SQL nuevas para el árbol en sí).
- Composición del tooltip de apertura (destinos de una regla aplicada) resuelta **por proveedor**, no solo por concepto — para que el total mostrado en el tooltip coincida con el importe de la fila que se está mirando.
- Drill-down a detalle (`ComprasDetalleModal`) funcionando en los tres niveles del nuevo árbol.

**No incluye (explícitamente fuera de alcance de esta fase):**
- Reglas de apertura a nivel proveedor (nivel 2 de la spec v2). El ícono "Aperturar" sigue targeteando el concepto de caja, igual que hoy — no se agrega la capacidad de crear una regla que aplique a "todas las compras de este proveedor".
- Cualquier cambio al modelo de datos de `reglas_apertura` / `destinos_regla` / `distribuciones_apertura`. No hay migración de Prisma en esta fase.
- Definir o implementar la convivencia/prioridad entre una futura regla de proveedor y una de concepto — ya está definida en la spec v2 (registro > proveedor > concepto) pero su implementación queda para cuando se aborde la Fase 2.

## 3. Diseño de datos

### 3.1 Árbol nuevo (paralelo al existente, no lo reemplaza)

El árbol actual (`PivotRubroRow → PivotConceptoRow → PivotProveedorRow`, en `lib/dashboard/types.ts`) queda intacto — sigue siendo la vista por defecto (`agrupacion=concepto`).

Se agregan tipos nuevos y paralelos para la vista por proveedor, en vez de reutilizar los tipos existentes forzando otro significado en sus campos (p. ej. meter un `proveedorId` donde hoy dice `rubroCodigo` sería confuso y viola el nombrado descriptivo que pide el proyecto). Es la segunda repetición de este patrón de árbol de 3 niveles — duplicación aceptable; si apareciera una tercera forma de agrupar, ahí sí conviene generalizar:

```ts
// nivel 2 (hoja) — una línea de compra individual dentro de un proveedor+concepto
export type PivotLineaRow = {
  readonly level: 2;
  readonly id: string;
  readonly rowId: string;
  readonly distribucionId: number | null;
  readonly conceptoCodigo: string;
  readonly fecha: string | null;
  readonly observac: string | null;
  readonly importe: number;
  readonly hasManualOverride: boolean;
  values: Record<number, number>;
  rowTotal: number;
};

// nivel 1 — concepto de caja, dentro de un proveedor
export type PivotConceptoSubRow = {
  readonly level: 1;
  readonly id: string;
  readonly nombre: string;         // nombre del concepto
  readonly conceptoCodigo: string;
  readonly rubroCodigo: string;    // referencia, no se renderiza como nivel propio acá
  values: Record<number, number>;
  rowTotal: number;
  children: PivotLineaRow[];
  composicion?: Record<number, ComposicionMes>; // scoped a este proveedor, ver 3.3
};

// nivel 0 — proveedor
export type PivotProveedorTopRow = {
  readonly level: 0;
  readonly id: string;
  readonly nombre: string;
  readonly proveedorId: number | null; // null = "Sin Proveedor"
  values: Record<number, number>;
  rowTotal: number;
  children: PivotConceptoSubRow[];
};

export type PivotDataPorProveedor = {
  rows: PivotProveedorTopRow[];
  columnTotals: Record<number, number>;
  grandTotal: number;
};
```

### 3.2 Construcción del árbol

`app/api/dashboard/pivot/route.ts` ya ejecuta una única query (`rowsQuery`) que trae, por cada línea de compra, rubro, concepto y proveedor juntos (`SqlRow`). Se agrega una función hermana de la actual `buildPivotData`:

```ts
function buildPivotDataByProveedor(sqlRows: SqlRow[], composicion: ...): PivotDataPorProveedor
```

Misma lógica de rollup bottom-up que ya existe (values por mes, rowTotal), solo cambia qué campo define el nivel 0 (`proveedor_id`/`proveedor_nombre` en vez de `rubro_codigo`/`rubro_nombre`) y qué campo define el nivel 1 (`concepto_codigo`/`concepto_nombre`, igual que hoy). El endpoint recibe un query param `agrupacion` (`"concepto" | "proveedor"`, default `"concepto"`) y llama a una u otra función — no se construyen los dos árboles en cada request.

### 3.3 Composición del tooltip, resuelta por proveedor

Las queries `composicionDestinosQuery` y `composicionOriginalesQuery` (mismo archivo) agregan `p.id AS proveedor_id` al `SELECT` y al `GROUP BY` (ya hacen `LEFT JOIN proveedores p`, no hace falta un join nuevo).

`lib/dashboard/apertura-composicion.ts` gana una función nueva, `buildComposicionPorProveedor`, hermana de la `buildComposicion` existente (que no se modifica — sus 3 tests actuales seguirán pasando igual). Mismo shape de entrada (con `proveedor_id` ahora presente), pero la clave de agrupación es `` `${conceptoCodigo}|${proveedorId ?? '__sin_proveedor'}` `` en vez de solo `conceptoCodigo`. Esto asegura que el tooltip en la vista por Proveedor muestre el reparto real de las compras de *ese* proveedor en *ese* concepto — no el total cruzando todos los proveedores (que es lo que mostraría si se reutilizara la función existente sin cambios).

## 4. UI

- **Toggle de agrupación**: en `components/dashboard/dashboard-filters.tsx`, junto a los filtros existentes de Compras (no aplica a Ventas/Resultados). Estado nuevo en `use-dashboard-store.ts` (`agrupacionCompras: "concepto" | "proveedor"`, persistido igual que `tab`/`year`).
- **`PivotTable`**: gana una tercera rama de render para `PivotProveedorTopRow` (estructuralmente igual a la rama de "rubro" actual: fila expandible + total + click a detalle) y reutiliza el patrón de la rama "concepto" actual para `PivotConceptoSubRow`, incluyendo el ícono "Aperturar" (Split) que sigue apareciendo ahí — no en la fila de proveedor — porque la regla sigue siendo de nivel concepto.
- **Drill-down**: clicks en cada nivel llaman `openDetalle` con la combinación de filtros correspondiente:
  - Nivel proveedor → `{ proveedorId }`
  - Nivel concepto (dentro de proveedor) → `{ proveedorId, conceptoCodigo }`
  - Nivel línea → `{ rowId, distribucionId }` (igual que hoy)
  `/api/dashboard/detalle` ya soporta `proveedorId` + `conceptoCodigo` combinados sin cambios (confirmado en el código actual — ambos son condiciones AND independientes).

## 5. Testing

- `lib/dashboard/apertura-composicion.test.ts`: agregar casos para `buildComposicionPorProveedor` (mismo estilo que los existentes) + un caso con `proveedor_id: null` ("Sin Proveedor").
- Nuevo archivo de test para `buildPivotDataByProveedor` (fixture de `SqlRow[]` con al menos dos proveedores y un concepto compartido entre ambos) — verificar que no se mezclan los totales entre proveedores y que el rollup por mes es correcto.
- Sin test de browser — limitación ya aceptada en el proyecto para este tipo de cambios de UI (ver historial de Fase C de Apertura de Gastos); se verifica manualmente contra datos reales antes de cerrar la tarea.

## 6. Riesgos / decisiones a vigilar durante el plan

- El campo `id` de cada nivel debe seguir la misma disciplina que ya documentó Apertura de Gastos Fase B/C para evitar colisiones de key de React cuando una compra distribuida genera N filas con el mismo `row_id` bajo el mismo padre — replicar el mismo esquema de `id` compuesto que ya usa el árbol por concepto.
- Si en el futuro aparece una tercera forma de agrupar (o la Fase 2 de reglas por proveedor necesita anidar de otra forma), este es el punto para evaluar generalizar los tres tipos de árbol en uno genérico — no antes.
