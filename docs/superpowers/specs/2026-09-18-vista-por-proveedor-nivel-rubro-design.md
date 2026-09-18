# Vista de Compras "por Proveedor" — agregar Rubro como nivel 0

Fecha: 2026-09-18
Estado: aprobado por el usuario en brainstorming, pendiente de plan de implementación

## 1. Contexto y objetivo

La vista "por Proveedor" del pivot de Compras (toggle "Ver por: Concepto | Proveedor", spec [[2026-09-11-vista-compras-por-proveedor-design]]) organiza hoy los gastos como `Proveedor (nivel 0) → Concepto de caja (nivel 1) → línea de compra (nivel 2)`. El rubro existe como dato de referencia en cada nodo de concepto (`rubroCodigo`), pero no se renderiza como nivel de agrupación propio.

Objetivo: agregar el rubro como nuevo nivel 0 de esta vista, corriendo un nivel a los existentes: `Rubro → Proveedor → Concepto de caja → línea de compra`. La vista "por Concepto" (default, `Rubro → Concepto → Proveedor` como hoja) **no se toca** — sigue siendo un árbol completamente separado, como ya documentó la spec de 2026-09-11 (§3.1, "duplicación aceptable").

## 2. Alcance

**Incluye:**
- Nuevo nivel Rubro (tope) en el árbol de la vista "por Proveedor" únicamente.
- Proveedor pasa de nivel 0 a nivel 1, Concepto de nivel 1 a nivel 2, línea de compra de nivel 2 a nivel 3 — sin cambios de comportamiento en ninguno de los tres, solo su posición en el árbol.
- Un proveedor con compras en más de un rubro aparece repetido, una vez bajo cada rubro (mismo patrón de duplicación que ya usa el árbol de la vista "por Concepto" con sus proveedores-hoja).
- El ícono "Aperturar" (Split) se mantiene exactamente donde está hoy: en las filas de Proveedor (nivel 1) y de Concepto (nivel 2), targeteando las mismas entidades (`nivel: "proveedor"` / `nivel: "concepto"`) que hoy. La fila de Rubro no tiene ícono Aperturar — ni la vista "por Concepto" lo tiene en su fila de rubro hoy.
- Drill-down (`ComprasDetalleModal`) en el nuevo nivel Rubro: filtra por `rubroCodigo` (`/api/dashboard/detalle` ya soporta ese filtro, usado hoy por la vista "por Concepto").
- Expandir/colapsar de a un nivel (click derecho) contempla el nivel nuevo — ver §4.

**No incluye (explícitamente fuera de alcance):**
- Cualquier cambio a la vista "por Concepto" (`PivotTableByConcepto`, `buildPivotData`, tipos `PivotRubroRow`/`PivotConceptoRow`/`PivotProveedorRow`).
- Cambios a reglas de apertura, a `AperturaGastosModal`, o a la prioridad registro > proveedor > concepto — el ícono Aperturar sigue apuntando a las mismas entidades que hoy, solo cambia su indentado visual.
- Cambios al modelo de datos (`reglas_apertura`, `destinos_regla`, etc.) ni migraciones de Prisma.
- No modifica datos de compras ya importados — es un cambio de agrupación para mostrarlos, no de los datos en sí.

## 3. Diseño de datos

### 3.1 Tipos (`lib/dashboard/types.ts`)

Se agrega `PivotRubroTopRow` (nivel 0) envolviendo el árbol existente. Los tres tipos actuales (líneas 72-115 hoy) suben un nivel: `PivotLineaRow` de nivel 2 a 3, `PivotConceptoSubRow` de nivel 1 a 2, `PivotProveedorTopRow` de nivel 0 a 1 (se renombra conceptualmente a "nivel medio", aunque puede conservar su nombre de tipo si el diff queda más chico así — a decidir en el plan).

```ts
// nivel 0 — rubro (nuevo)
export type PivotRubroTopRowPorProveedor = {
  readonly level: 0;
  readonly id: string;
  readonly nombre: string;
  readonly rubroCodigo: string;
  values: Record<number, number>;
  rowTotal: number;
  children: PivotProveedorTopRow[]; // ahora nivel 1
};

export type PivotDataPorProveedor = {
  rows: PivotRubroTopRowPorProveedor[]; // antes: PivotProveedorTopRow[]
  columnTotals: Record<number, number>;
  grandTotal: number;
};
```

`PivotProveedorTopRow.level` pasa de `0` a `1`, `PivotConceptoSubRow.level` de `1` a `2`, `PivotLineaRow.level` de `2` a `3`. Sin cambios de campos.

### 3.2 Construcción del árbol (`lib/dashboard/pivot-por-proveedor.ts`)

Se agrega una capa de agrupación por `rubro_codigo`/`rubro_nombre` **por fuera** de la agrupación por proveedor existente. Cambio de clave: hoy `provKey` identifica al proveedor globalmente; pasa a `provKey = \`${rubroKey}|${proveedorKeyOriginal}\`` para que el mismo proveedor genere un nodo distinto por cada rubro en el que tiene compras (igual disciplina de `id` compuesto que ya usa esta vista para líneas, ver spec 2026-09-11 §6). `concKey` se compone igual que hoy pero colgando del nuevo `provKey`.

El rollup bottom-up (líneas 94-110 actuales) gana un cuarto nivel: después de sumar concepto→proveedor, se suma proveedor→rubro.

Como cada concepto ya trae fijo un único `rubroCodigo` (dato de referencia existente), un proveedor+concepto nunca puede terminar bajo dos rubros distintos — no hay ambigüedad en la agrupación nueva.

### 3.3 Composición del tooltip (`lib/dashboard/apertura-composicion.ts`)

Sin cambios. `buildComposicionPorProveedor` ya usa la clave `concepto|proveedorId`, que no depende de dónde se ubique el rubro en el árbol — se revisa al implementar pero no se espera necesidad de tocar este archivo.

## 4. UI y estado de expansión

### 4.1 Render (`components/dashboard/pivot-table-por-proveedor.tsx`)

Nueva rama de render para las filas `rubroTop` (nivel 0): fila expandible + total + click a detalle por `rubroCodigo`, sin ícono Aperturar — estructuralmente igual a como `pivot-table-por-concepto.tsx` ya renderiza su fila de rubro. Las ramas existentes (`proveedorTop`, `conceptoSub`, `linea`) se mantienen igual, solo un nivel más indentadas (`pl-5` → siguiente escalón de indent, a definir el valor exacto en el plan).

### 4.2 Flatten/sort (`lib/dashboard/pivot-utils.ts`)

`flattenRowsPorProveedor` y `sortPivotRowsPorProveedor` están hoy escritas para exactamente 3 niveles fijos (no son recursivas sobre profundidad arbitraria) — necesitan un nivel más de anidamiento explícito en ambas funciones, mismo patrón que ya usan `flattenRows`/`sortPivotRows` de la vista "por Concepto" para su propio árbol de 3 niveles. `FlatRowPorProveedor` gana el variante `{ type: "rubroTop"; data: PivotRubroTopRowPorProveedor }`.

### 4.3 Expansión automática por filtro (`use-pivot-screen-data-por-proveedor.ts`)

El `useEffect` que auto-expande ids al aplicar un filtro (líneas 31-49 actuales) agrega el id de rubro a la expansión, además de proveedor y concepto, para que un resultado filtrado quede visible sin clicks manuales.

### 4.4 Colapsar por nivel (click derecho)

Hoy hay dos niveles de colapso: `collapseAll` (click derecho en fila de proveedor, tope actual) y `collapseConceptos` (click derecho en fila de concepto, colapsa concepto+línea mantiene proveedor expandido). Con el nivel nuevo:
- `collapseAll` pasa a la fila de Rubro (nuevo tope).
- Se agrega una función análoga a `collapseConceptos` pero un nivel arriba (colapsa proveedor+concepto+línea, mantiene rubro expandido) para el click derecho en la fila de Proveedor.
- `collapseConceptos` se mantiene igual en la fila de Concepto (colapsa concepto+línea, mantiene rubro y proveedor expandidos).

El nombre exacto de la función nueva y su implementación puntual quedan para el plan.

## 5. Testing

- Test unitario nuevo o actualizado para `buildPivotDataByProveedor`: caso proveedor con compras en un solo rubro (árbol de 4 niveles correcto), caso proveedor con compras en dos rubros (debe aparecer duplicado, cada instancia con sus propios `children`/totales, sin mezclar importes entre rubros), totales de rubro = suma de sus proveedores, columnTotals/grandTotal sin cambios respecto al total ya validado en el árbol de 3 niveles.
- `lib/dashboard/pivot-utils.test.ts` ya tiene tests de `flattenRowsPorProveedor`/`sortPivotRowsPorProveedor` que construyen `PivotDataPorProveedor.rows` directamente con `PivotProveedorTopRow` (asumiendo que son nivel 0) — hay que actualizarlos para envolver esas filas en el nuevo `PivotRubroTopRowPorProveedor`, no son tests nuevos sino existentes que van a romper con el cambio de tipos.
- `apertura-composicion.test.ts`: sin casos nuevos esperados (§3.3), correr los existentes para confirmar que siguen pasando sin modificación.
- Sin test de browser — misma limitación ya aceptada en el proyecto (ver [[project_apertura_gastos_fase_c_estado]]); verificación manual contra datos reales antes de cerrar la tarea.

## 6. Riesgos / decisiones a vigilar durante el plan

- Mantener la disciplina de `id` compuesto (rubro+proveedor+concepto+línea) para evitar colisiones de key de React, replicando el criterio ya usado en esta misma vista para el nivel línea.
- `flattenRowsPorProveedor`/`sortPivotRowsPorProveedor` no son genéricas por profundidad — el cambio es mecánico (un nivel más) pero hay que tocar ambas funciones explícitamente, no alcanza con cambiar los tipos.
- Verificar que ningún otro consumidor fuera de esta vista lea `PivotDataPorProveedor`/`PivotProveedorTopRow` asumiendo que `rows` son proveedores de nivel 0 (grep antes de tocar los tipos).
