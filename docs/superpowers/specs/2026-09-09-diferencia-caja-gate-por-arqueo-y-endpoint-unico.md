# Fix — Diferencia de caja: celda vacía sin arqueo + endpoint único

**Fecha:** 2026-09-09
**Reportado por:** Diego Sebastián Albo (reunión de demo — observado en la vista 2025 del Dashboard de Resultados)
**Prioridad:** Alta — afecta la lectura del resultado del negocio y revierte un criterio de aceptación ya entregado
**Specs relacionados:** `2026-08-24-fix-diferencia-caja-design.md` (este documento revierte su CA-03 en la parte de display)
**Memoria relacionada:** `project_fix_diferencia_caja_spec.md`

## 1. Contexto

### 1.1 La falla observada

En la reunión de demo, mirando el año **2025** del Dashboard de Resultados, Diego observó:

- La fila "Diferencia de caja" **calcula un valor en meses que no tienen "Disponible en caja" (arqueo) cargado**.
- Ese valor se **repite hacia adelante**: el mismo número aparece en cada mes sin arqueo posterior y también en el total anual.
- Los meses **anteriores** al primer arqueo no los toca (quedan en "—").
- Caso concreto de la captura: agosto tiene Resultado OP pero sin arqueo → `-$51.865.104` arrastrado a septiembre, octubre y noviembre, y al total anual.

No es un bug dependiente del año: el código hace lo mismo para 2025 y 2026. En 2026 no se nota porque (casi) todos los meses hasta la fecha tienen arqueo cargado; en 2025 hay meses sin arqueo y ahí se ve el arrastre.

### 1.2 Causa raíz

`computeDiferenciaCajaAcumulada` (`lib/dashboard/resultados-calc.ts`) asigna `resultado[i] = acc` en **todos** los meses posteriores al primer arqueo, tenga ese mes un arqueo propio o no. Un mes sin arqueo aporta `0` de variación de Disponible pero igual pinta la celda con el valor acumulado corriente.

Esto es **deliberado** en el spec del 24-ago (§3.2, CA-03): *"un mes sin `disponible` propio sigue sumando, solo aporta `0` de ese término, no corta la cadena"*. En ese momento Diego pidió continuidad a través de los meses sin arqueo (*"el arqueo sirve como caja inicial para el próximo mes"*). Viéndolo funcionando, ahora pide lo contrario para el **display**: mes sin arqueo → celda vacía, nunca un número.

### 1.3 Decisión

- **Mes sin arqueo cargado → "—", nunca un número.** No hay arrastre visible hacia adelante.
- **La continuidad interna se preserva** (Opción A). El acumulador y la referencia del último arqueo siguen corriendo por detrás sobre los meses sin arqueo. Un arqueo de noviembre reconcilia contra el arqueo de julio, arrastrando el término contable de agosto, septiembre y octubre — pero esos tres meses se muestran "—".
- Esto **revierte la parte de display de CA-03** del spec del 24-ago. La intención de continuidad de CA-03 se mantiene; solo cambia qué se dibuja.

### 1.4 Segundo problema — latencia de carga

En un refresh o carga inicial, la fila tarda visiblemente en aparecer (hoy muestra `…`). Causas:

1. **Waterfall.** `useDiferenciaCaja` pide primero `/api/dashboard/flujo-caja/primer-arqueo`; recién cuando resuelve dispara el resto.
2. **Fan-out.** Por cada año del rango `[primerArqueo.anio .. year]` hace `Promise.all` de 4 endpoints (`pivot-ventas`, `pivot` compras, `pivot` resultados, `flujo-caja`). Con primer arqueo en 2025 y vista 2026 → 8 queries `force-dynamic`, cada una un `$queryRaw` sobre `v_compras_distribuidas` o `ventas`.
3. **Sin reuso de caché.** Esos pivots son los mismos que ya trae la pantalla vía `useOperacionKpis`, pero con otra query key → se piden dos veces por carga.
4. Diferencia de caja solo necesita 4 números por mes (ingresos, egresos, ganancia, disponible); hoy baja el árbol completo de rubro/concepto/proveedor y tira el resto.

### 1.5 I-3 — fuera de alcance (documentada, no resuelta)

Los endpoints de pivot arman mapas dispersos: una clave de mes existe solo si hubo filas que matchearon. El `?? 0` no distingue "el mes tuvo $0 de verdad" de "no hay dato para ese mes" (import pendiente). Bajo el modelo acumulado, un `0` de un mes con dato faltante subvalúa en silencio el acumulado en el próximo mes con arqueo mostrado.

Este spec **no** resuelve I-3. La nota se arrastra al nuevo helper de agregación. Atacarla necesita definir (a) cómo se detecta "el mes tiene datos de operación" y (b) qué se muestra cuando un mes del período de acumulación no los tiene — decisión pospuesta explícitamente por Diego/Imanol el 2026-09-09.

## 2. Alcance

**Dentro:**

- Endpoint nuevo `GET /api/dashboard/diferencia-caja` — agregación server-side en un round trip.
- Helper `lib/dashboard/primer-arqueo.ts` — la query `findFirst` del arqueo más viejo, compartida.
- Helper puro `lib/dashboard/diferencia-caja-serie.ts` — arma la serie y llama al cálculo, testeable sin DB.
- `computeDiferenciaCajaAcumulada` — el mes sin arqueo devuelve `null` en vez del acumulado.
- `useDiferenciaCaja` — reescrito como wrapper fino sobre el endpoint nuevo.
- `caja-rows.tsx` — `<Spinner size="sm" />` en toda celda en estado de carga de la sección Caja (Disponible en caja + Diferencia de caja, celda y total); textos de tooltip/popover actualizados; invalidación de query key ajustada.
- Limpieza: se borran la ruta `app/api/dashboard/flujo-caja/primer-arqueo/route.ts` y `buildPrimerArqueoUrl` (`lib/dashboard/params.ts`) — quedan sin consumidores.
- Tests reescritos en `resultados-calc.test.ts` + tests nuevos del helper de serie.

**Fuera:**

- I-3 (§1.5).
- Carga/edición de "Disponible en caja" (`FlujoCajaManual`, `PUT /api/dashboard/flujo-caja`) — no se toca.
- Cambios de schema de Prisma o migraciones — el endpoint nuevo es de solo lectura.
- La fórmula de Diferencia de caja en sí (`Resultado OP − Ganancia + variación de Disponible`) — no cambia.
- Los endpoints de pivot existentes — siguen como están; el endpoint nuevo no los reemplaza para el resto de la pantalla.
- Vistas fuera del Dashboard de Resultados.

## 3. Arquitectura

```
GET /api/dashboard/diferencia-caja?year=&localId=&puntoDeVentaId=
  │
  ├─ requireAuth()
  ├─ Zod safeParse de query params
  ├─ findPrimerArqueo(prisma, { localId, puntoDeVentaId })      → lib/dashboard/primer-arqueo.ts
  │     └─ null | { anio, mes }
  ├─ corte temprano: sin arqueo | primerArqueo.anio > year      → { diferenciaPorMes: {1..12: null} }
  ├─ rango = [primerArqueo.anio .. year]
  ├─ 4 agregados SQL sobre el rango (Promise.all):
  │     • ventas            SUM(COALESCE(importeManual, importe)) GROUP BY año, mes
  │     • compras dashboard SUM(...) GROUP BY año, mes   (visibleEnDashboard, filterRubrosOcultos)
  │     • compras resultados SUM(...) GROUP BY año, mes  (visibleEnResultados, filterRubrosOcultos)
  │     • flujoCajaManual   findMany + aggregateFlujoCajaPorMes por año del rango
  ├─ buildDiferenciaCajaSerie({ rango, primerArqueo, totales }) → lib/dashboard/diferencia-caja-serie.ts (puro)
  │     └─ MesDatos[] del rango → computeDiferenciaCajaAcumulada → recorta a `year`
  └─ { diferenciaPorMes: Record<1..12, number | null> }
```

### 3.1 Endpoint nuevo

`GET /api/dashboard/diferencia-caja`

- **Auth:** `requireAuth()`, igual que el resto de `/api/dashboard`. Sin dependencia de RLS (§5 del CLAUDE.md).
- **Query params (Zod `safeParse`):** `year: z.coerce.number().int()` (requerido), `localId` / `puntoDeVentaId`: `z.coerce.number().int().optional()`. Año fuera de rango razonable → responde 200 con los 12 meses en `null` (mismo criterio que `GET /api/dashboard/flujo-caja`), no 400.
- **`dynamic = "force-dynamic"`.**
- **Filtros aplicados:** `localId` / `puntoDeVentaId` (el selector de local de la pantalla). **No** aplica rubro / concepto / proveedor / observación / meses — la fila Diferencia de caja siempre usa el año completo sin esos filtros, igual que hoy `fetchYearTotals`.
- **Agregados SQL:** reusan `buildPivotConditions` para el `WHERE` (año, guardas de fecha/importe, `localId`/`pdvId`, `filterRubrosOcultos` con la columna de visibilidad correcta). El `SELECT` reemplaza el volcado fila-por-fila por `EXTRACT(YEAR ...)`, `EXTRACT(MONTH ...)::int`, `SUM(COALESCE(importeManual, importe))` con `GROUP BY` por año y mes. Se conservan los `LEFT JOIN conceptos_caja` / `rubros_concepto_caja` que los predicados de visibilidad necesitan. El rango multi-año se cubre con `EXTRACT(YEAR ...) IN (...)` o un `BETWEEN` de fechas — a decidir en el plan.
- **Response:** `{ diferenciaPorMes: Record<number, number | null> }` (claves 1..12 del `year` pedido).
- **Errores:** `try/catch` con `console.error("[GET /api/dashboard/diferencia-caja]", err)` y `500` — nada de `catch {}` vacío (§2 del CLAUDE.md).

### 3.2 `lib/dashboard/primer-arqueo.ts` (helper compartido)

```ts
export async function findPrimerArqueo(
  prisma: PrismaClient,
  filtro: { localId?: number; puntoDeVentaId?: number },
): Promise<{ anio: number; mes: number } | null>
```

Misma query que hoy vive inline en `app/api/dashboard/flujo-caja/primer-arqueo/route.ts`:
`findFirst({ where: { monto: { not: 0 }, ...filtro }, orderBy: [{ anio: "asc" }, { mes: "asc" }], select: { anio: true, mes: true } })`.
El `monto: { not: 0 }` implementa "un $0 es sin dato, no ancla el cálculo" (spec 2026-08-31).

La ruta standalone `/api/dashboard/flujo-caja/primer-arqueo` se elimina — su único consumidor era `useDiferenciaCaja`.

### 3.3 `lib/dashboard/diferencia-caja-serie.ts` (helper puro)

```ts
export function buildDiferenciaCajaSerie(input: {
  year: number;
  primerArqueo: { anio: number; mes: number } | null;
  totalesPorAnio: Record<number, {
    ingresosPorMes: Record<number, number>;
    egresosPorMes: Record<number, number>;
    gananciaPorMes: Record<number, number>;
    disponiblePorMes: Record<number, number | null>;
  }>;
}): Record<number, number | null>
```

- Arma `serie: MesDatos[]` concatenando los 12 meses de cada año del rango `[primerArqueo.anio .. year]` en orden.
- El `?? 0` para ingresos/egresos/ganancia y `?? null` para disponible se mantiene tal cual hoy en `toSerieDeUnAnio` — **incluida la limitación I-3 (§1.5)**, que se documenta acá con el mismo comentario que hoy está en `use-diferencia-caja.ts`.
- Llama `computeDiferenciaCajaAcumulada(serie, primerArqueo)`.
- Recorta al `year` pedido: `diferenciaPorMes[mes] = acumulado[(year - primerArqueo.anio) * 12 + (mes - 1)]`.
- Sin arqueo o `primerArqueo.anio > year` → los 12 meses en `null`.

Es pura: sin fetch, sin Prisma, sin React. Se testea con fixtures.

### 3.4 `computeDiferenciaCajaAcumulada` — cambio puntual

`lib/dashboard/resultados-calc.ts`. El loop no cambia su acumulación; cambia **solo la asignación a la celda**:

```ts
for (let i = i0 + 1; i < serie.length; i++) {
  const m = serie[i];
  const arqueo = m.disponible !== 0 ? m.disponible : null;
  const deltaDisponible = arqueo != null ? arqueo - referencia : 0;
  if (arqueo != null) referencia = arqueo;
  acc += deltaDisponible - ((m.ingresos - m.egresos) - m.ganancia);
  resultado[i] = arqueo != null ? acc : null;   // ← antes: resultado[i] = acc
}
```

- `acc` y `referencia` se actualizan todos los meses → la cadena no se corta (intención de CA-03 preservada).
- El mes se muestra solo si tiene arqueo real (`disponible != null && disponible != 0`).
- El mes del primer arqueo (`i0`) y los anteriores siguen en `null` (CA-02, sin cambios).
- El comentario de la función se actualiza para reflejar el nuevo criterio de display y la reversión de CA-03.

### 3.5 `useDiferenciaCaja` — reescrito

`hooks/use-diferencia-caja.ts`. De ~135 líneas a ~20:

```ts
export function useDiferenciaCaja({ year, localId, pdvId }: Params) {
  const { data, isLoading, isError } = useFetchQuery<{ diferenciaPorMes: Record<number, number | null> }>(
    ["diferencia-caja", year, localId, pdvId],
    buildDiferenciaCajaUrl(year, localId, pdvId),
    { staleTime: 30_000 },
  );
  const diferenciaPorMes: Record<number, number | null> = {};
  for (const mes of MONTH_IDXS) diferenciaPorMes[mes] = data?.diferenciaPorMes[mes] ?? null;
  return { diferenciaPorMes, isLoading, isError };
}
```

- Contrato de retorno **idéntico** al de hoy (`{ diferenciaPorMes, isLoading, isError }`) → `caja-rows.tsx` no cambia su forma de consumo.
- Se borran `fetchYearTotals`, `toSerieDeUnAnio`, `fetchJson`, el `useQueries` multi-año y el import de `computeDiferenciaCajaAcumulada` (pasa a usarse server-side).
- `buildDiferenciaCajaUrl(year, localId, pdvId)` nuevo en `lib/dashboard/params.ts`, reemplaza a `buildPrimerArqueoUrl` (que se borra).

### 3.6 UI — `caja-rows.tsx`

- **Spinner en toda celda que carga en la sección Caja:**
  - `ValueCell` gana una prop `loading?: boolean`. Cuando es `true` renderiza `<Spinner size="sm" />` centrado en la celda en vez de `text`. `text` sigue siendo `string`.
  - Las celdas de "Disponible en caja" (líneas ~166 y ~179, hoy `<span>{flujoCajaLoading ? "…" : ...}</span>`) renderizan `<Spinner size="sm" />` inline en vez del `…`.
  - Las 4 celdas afectadas: Disponible en caja (mes + total), Diferencia de caja (mes + total).
- **Textos:**
  - Popover de Diferencia de caja: la descripción aclara que **solo los meses con "Disponible en caja" cargado muestran un valor**; los demás quedan en "—".
  - La línea "Sin dato:" del popover suma "…o cualquier mes sin arqueo cargado" al listado actual.
  - El tooltip del total (`title="Saldo acumulado al último mes con cálculo válido"`) se mantiene: ese "último mes con cálculo válido" ahora es, por definición, el último mes del año con arqueo.
- **Invalidación:** tras editar un arqueo (`onSuccess` del `PUT`, ~línea 108), reemplazar las dos invalidaciones (`["diferencia-caja-primer-arqueo"]`, `["diferencia-caja-year-totals"]`) por una sola sobre el prefijo `["diferencia-caja"]`.
- El total anual sigue calculándose en el componente como "último mes de `months` (de atrás para adelante) con valor no-null" — con la regla nueva, ese es el último mes con arqueo. Sin cambios de código en ese bloque.

## 4. Testing

- **`lib/dashboard/resultados-calc.test.ts`** (`computeDiferenciaCajaAcumulada`):
  - CA-03 se reescribe: el mes sin arqueo propio (hoy espera `-40`) ahora espera `null`; el mes siguiente **con** arqueo sigue esperando el acumulado que arrastra el término contable del mes intermedio.
  - Caso nuevo: gap de varios meses consecutivos sin arqueo → todos `null`, y el primer mes con arqueo posterior reconcilia contra el último arqueo real (no contra el mes inmediato anterior).
  - Los dos casos de "disponible en 0" se ajustan al mismo criterio (mes con `disponible: 0` → `null` en la celda, sin cortar el acumulado).
  - CA-01, CA-02, CA-04 y el caso cross-año no cambian de expectativa (siguen dando `null` donde daban `null`).
  - El fixture de regresión "runaway del 13-ago" se mantiene, ajustando las posiciones que ahora son `null` si aplica.
- **`lib/dashboard/diferencia-caja-serie.test.ts`** (nuevo, `buildDiferenciaCajaSerie`):
  - Rango de un solo año; rango cross-año (primer arqueo en año anterior).
  - `primerArqueo === null` → 12 `null`.
  - `primerArqueo.anio > year` → 12 `null`.
  - Recorte correcto al año pedido (que el offset multi-año mapee al mes correcto).
  - Mapa de totales disperso (mes ausente) → se trata como hoy (`?? 0` / `?? null`), documentando I-3.
- **Endpoint `GET /api/dashboard/diferencia-caja`:** sin test unitario propio (query directa de Prisma + helpers ya testeados, mismo criterio que `import_logs` y el endpoint `primer-arqueo` original). Se cubre por code review + verificación manual.
- **`useDiferenciaCaja`:** sin test unitario propio (no hay infra de test de hooks con TanStack Query en el repo, igual que el resto del dashboard).
- **`flujo-caja-agg.test.ts`:** no cambia (`aggregateFlujoCajaPorMes` se reusa sin tocar).
- **Verificación manual contra producción (criterio de cierre):** comparar `diferenciaPorMes` del endpoint nuevo contra el valor que hoy muestra la pantalla, para varias combinaciones `(year, localId, puntoDeVentaId)` — incluyendo el caso 2025 que Diego señaló. Confirmar: (a) los meses sin arqueo dan "—", (b) los meses con arqueo dan el mismo número que el modelo viejo daría en ese mes, (c) el total anual coincide con el último mes con arqueo, (d) mejora perceptible de latencia de carga.

## 5. Riesgos / notas

- **Correctitud de los agregados.** El `SUM(COALESCE(importeManual, importe))` plano por mes tiene que reproducir exactamente los `columnTotals` que hoy producen los 3 endpoints de pivot (`buildPivotData`). El pivot de compras vuelca fila por fila desde `v_compras_distribuidas` (rama distribuida = una fila por destino con el importe ya prorrateado) y suma en JS; un `GROUP BY` sobre la misma vista con el mismo `WHERE` debería dar el mismo total, pero es el riesgo principal y por eso la verificación manual contra datos reales es criterio de cierre, no opcional.
- **Dato financiero visible al cliente.** Cualquier discrepancia en la fórmula, el gate o el total anual se nota de inmediato. Los tests unitarios no alcanzan; la comparación contra los valores reales manda.
- **Reversión de un CA entregado.** CA-03 del spec del 24-ago queda revertido en su parte de display. Se actualiza `project_fix_diferencia_caja_spec.md` y se referencia este documento desde el spec anterior.
- **I-3 sigue viva.** El cambio de display la hace menos visible (afecta solo al próximo mes con arqueo, no a toda la cadena dibujada) pero no la elimina. Queda documentada en `diferencia-caja-serie.ts`.
- **Endpoint de solo lectura**, sin riesgo sobre datos de compras/ventas ya importados. No toca schema.
- **Caché.** El endpoint nuevo tiene su propia query key; no comparte caché con `useOperacionKpis`, pero al ser un solo request liviano el costo de no compartir es chico (a diferencia de hoy, que re-dispara los 3 pivots pesados).
