# Totales de mes/año clickeables + drill-down que respeta filtros — Design

## Contexto

Pedido del cliente (tabla de gastos): "puedo abrir el modal con los totales
de gastos por rubro pero no por mes ni año, lo cual me ayuda a buscar
registros dentro de un período más que dentro de un rubro".

Hoy, en la tabla pivot de compras (vistas por concepto y por proveedor), las
celdas y el total de cada rubro abren `ComprasDetalleModal` vía
`openDetalle`. La fila de pie "Total {año}"
(`components/dashboard/pivot-table-foot.tsx`) muestra totales por mes y el
total anual, pero no es clickeable.

La exploración encontró tres desfases que hacen que "cablear el pie" no
alcance:

1. **Truncado silencioso.** `GET /api/dashboard/detalle` corta con
   `LIMIT 2000` sin avisar. Un año entero sin filtro de rubro puede
   superarlo → el modal mostraría menos filas que el total clickeado, sin
   indicarlo (CLAUDE.md §2: nada de datos financieros que se pierdan en
   silencio).
2. **Visibilidad con criterio distinto.** Sin filtro de rubro/concepto, la
   API de detalle excluye rubros ocultos usando el concepto **original**
   (`rc`, `c."conceptoCodigo"`); el pivot usa el concepto **efectivo**
   (`COALESCE(manual, original)`). Una compra reclasificada a mano entre un
   rubro visible y uno oculto hace que la suma del modal no coincida con el
   total del pie.
3. **Filtros globales ignorados.** `openDetalle` (en
   `hooks/use-pivot-screen-data.ts` y
   `hooks/use-pivot-screen-data-por-proveedor.ts`) solo manda
   año/local/PDV + lo que trae el click. Los totales del pivot sí vienen
   filtrados por rubro, concepto, proveedor, observación y selección
   parcial de meses → hoy, con cualquiera de esos filtros activo, el modal
   de un total de rubro muestra más compras que el número clickeado. Se
   decidió (brainstorming 08-oct-2026) arreglarlo para **todos** los
   drill-down, no solo para el pie nuevo.

## Objetivo

- Celdas de mes y total anual del pie de la tabla de gastos clickeables,
  abriendo el modal de detalle con las compras de ese período.
- Todo drill-down de compras (Compras por concepto, Compras por proveedor,
  Resultados) respeta los filtros activos del dashboard, de modo que la
  suma del modal coincida con el número clickeado.
- Ningún truncado silencioso en el modal de detalle.

## No-objetivos

- No se toca Ventas (su pivot y su modal quedan como están).
- No se corrige que la API de detalle use `visibleEnDashboard` también
  cuando el click viene de Resultados (que filtra por `visibleEnResultados`).
  Desfase ya existente, fuera de alcance — se documenta como límite conocido.
- No se agrega paginación ni virtualización al modal.
- No se modifica ningún dato de compras/ventas: todo el cambio es de
  lectura + UI.

## Diseño

### 1. Armado del filtro de detalle — función pura

Nuevo `buildDetalleFilter(base, globales, extra)` en `lib/dashboard/`
(archivo propio, con tests):

- `base`: `{ year, localId?, pdvId? }`.
- `globales`: `{ rubroCodigo?, conceptoCodigo?, proveedorId?,
  observacionQuery?, activeMonths? }` — los filtros del dashboard
  (`useDashboard`). `activeMonths` es `undefined` cuando están los 12 meses
  (misma semántica que el store).
- `extra`: lo que trae el click (forma actual de `openDetalle`).

Precedencia (gana lo más específico, lo del click):

| Caso | Resultado |
|---|---|
| `extra.mes` presente | se usa `mes`; `meses` no se manda |
| `extra.mes` ausente y `activeMonths` definido | `meses = activeMonths` |
| `extra.conceptoCodigo` presente | pisa `globales.conceptoCodigo` |
| `extra.rubroCodigo` presente | pisa `globales.rubroCodigo` |
| `extra` trae `proveedorId`, `proveedorTexto` o `sinProveedor` | se descarta `globales.proveedorId` |
| `extra.rowId` presente | se devuelve solo `base` + `rowId`/`distribucionId` (la API ya ignora todo lo demás en esa rama; no se arrastran globales para no ensuciar el queryKey) |
| `observacionQuery` | siempre de `globales` (los clicks no lo traen) |

Los dos hooks (`usePivotScreenData`, `usePivotScreenDataPorProveedor`)
reciben además `rubroCodigo` y `activeMonths` como params y usan
`buildDetalleFilter` en `openDetalle`. `useResultadosData` y los dos
componentes de tabla de compras pasan esos valores (ya los tienen de
`useDashboard`). Resultados hereda el arreglo por compartir
`usePivotScreenData`.

### 2. `DetalleFilter` y URL

- `DetalleFilter` suma `observacionQuery?: string` y `meses?: number[]`.
- `buildComprasDetalleUrl` serializa `observacionQuery` y `meses`
  (param `months`, coma-separado — mismo formato que el resto del
  dashboard). Si hay `mes`, `months` no se manda.

### 3. API `GET /api/dashboard/detalle`

- **Observación:** condición
  `COALESCE(c."observacManual", c.observac) ILIKE <patrón>`. El armado del
  patrón con escape de `%`, `_` y `\` se extrae de
  `buildPivotConditions` (`lib/dashboard/query-builders.ts`) a un helper
  compartido y lo usan ambos — no se duplica el escape. Validado con
  `textoLibreSchema`.
- **Meses:** param `months` parseado con el mismo schema que
  `parseDashboardParams` (`monthsParam`, se exporta). Si hay `mes` válido,
  gana `mes` (rango de fechas actual). Si no, se agrega
  `EXTRACT(MONTH FROM COALESCE(c."fechaManual", c.fecha))::int IN (...)`,
  igual que el pivot.
- **Visibilidad (rama sin rubro ni concepto):** pasa a
  `(rc_ef."visibleEnDashboard" = true OR (rc_ef.codigo IS NULL AND sinRubroVisibleSql("visibleEnDashboard")))`
  — mismo criterio que `buildPivotConditions`. Cambia también el
  drill-down por proveedor de la vista por proveedor (que usa esta rama),
  que pasa a coincidir con su total.
- **Límite:** `LIMIT 5001`; si vuelven más de 5000 filas se devuelven
  5000 y `hasMore: true`. El recorte vive en una función pura testeada
  (`recortarConHasMore(rows, limit)`). La respuesta pasa a ser
  `{ data, hasMore }` (`DetalleResponse` ya tiene el campo).

### 4. UI

- `PivotTableFoot` recibe `onMonthClick?(mes)` y `onTotalClick?()`. Celdas
  clickeables con el mismo estilo hover/cursor que las celdas de rubro
  (`PivotRubroRow`). Sin callback → se renderiza como hoy.
- Las dos tablas de compras pasan
  `onMonthClick={(mes) => openDetalle({ mes })}` y
  `onTotalClick={() => openDetalle({})}`. Con la precedencia de §1, el
  total anual con selección parcial de meses abre exactamente esos meses.
- `DetalleModalShell`: si `response.hasMore`, muestra un aviso visible
  arriba de la tabla: "Se muestran las primeras 5.000 compras — filtrá por
  mes para ver el resto."

## Manejo de errores

- Params inválidos de la API (`months`, `observacionQuery`) siguen el
  criterio existente de la ruta: inválido = sin filtro (no 400), igual que
  `mes`/`localId` hoy.
- El truncado nunca es silencioso: `hasMore` + aviso en el modal.

## Testing (TDD)

- `buildDetalleFilter`: cada fila de la tabla de precedencia, más el caso
  sin globales (comportamiento idéntico al actual).
- Helper de patrón ILIKE: `%`, `_`, `\` escapados; texto normal envuelto
  en `%…%`. El test existente del pivot sigue pasando.
- `buildComprasDetalleUrl`: `observacionQuery`, `meses`, y `mes` gana
  sobre `meses`.
- `recortarConHasMore`: menos, igual y más filas que el límite.
- UI (pie clickeable, aviso): no hay tests de componentes en el repo →
  `npm run lint` + `npm run build` + pasada visual del usuario.

## Límites conocidos

- Resultados abre el detalle con visibilidad de Compras
  (`visibleEnDashboard`), no `visibleEnResultados` (ya existía).
- Más de 5000 compras en un período: el modal avisa pero no permite verlas
  todas; el usuario tiene que acotar por mes.
