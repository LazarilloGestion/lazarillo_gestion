# Apertura de gastos — Fixes: origen de regla, tooltip de composición, reevaluación al editar

**Fecha:** 2026-08-31
**Reportado por:** Cliente (Diego Albo) — lista de 3 comportamientos esperados / errores
**Prioridad:** Alta — afecta la correctitud de la distribución de gastos en el Dashboard
**Memorias relacionadas:** `project_apertura_gastos_spec.md`, `project_apertura_gastos_fase_b_estado.md`,
`project_apertura_gastos_fase_c_estado.md`, `project_apertura_gastos_fase_d_estado.md`, `project_etapa2.md`
**Estado del entorno:** rama `dev`. Las reglas de apertura vigentes se dan de baja (wipe) como parte
de la migración — no hay backfill. Los datos de compras del ERP NO se tocan (solo los flags
`esDistribuido` / `distribuidoEn`).

---

## 1. Contexto

La feature "Apertura de gastos" (Etapa 2, ítem 2.7) se implementó en Fases A–D. Distribuye el
importe efectivo de un gasto entre locales/PDV según % configurados, sin tocar el registro del
ERP, generando "distribuciones" (`distribuciones_apertura`) que la vista `v_compras_distribuidas`
expone como N filas (una por destino) que `pivot`/`detalle` consumen.

El cliente reportó tres cosas. Una es una feature nueva (tooltip de composición); las otras dos
son defectos: uno es una **regresión respecto de la spec funcional** (las reglas no están acotadas
a su local/PDV de origen) y el otro es un **gap conocido y documentado** (editar un registro no
dispara la reevaluación de reglas).

### 1.1 — Tooltip de composición (feature nueva)

Cuando un concepto tiene apertura aplicada, al pasar el mouse sobre el importe de un mes debe
verse un tooltip con la composición porcentual hacia cada destino.

Ejemplo del cliente:
`100% · $ 105.704 → 70% Actual $ 73.993 · 10% Canchas Ramos $ 10.570 · 10% Canchas SJ $ 10.570 · 10% Descartado $ 10.571`

Aplica a **cada celda mensual del concepto** aperturado (no a la fila de rubro ni a las filas de
proveedor). El tooltip muestra **siempre la composición completa** (todos los destinos), incluso
cuando el dashboard está filtrado por un local/PDV puntual.

"Descartado" en el ejemplo del cliente no existe en el código y el cliente no supo definirlo —
**queda explícitamente fuera de alcance** hasta que lo aclare. Si es un destino apuntando a un
local llamado así, la feature ya lo cubre sin cambios; si es una porción no imputada, es otro
diseño aparte.

### 1.2 — Reglas aplican fuera de su origen (regresión vs. spec funcional)

**Falla observada (reproducida por el cliente):** en Bar Ramos Mejía se creó una regla de apertura
sobre "Alquiler" con destino 100% FC Ramos. El sistema también aperturó los gastos de "Alquiler"
de San Justo — que quedan en cero, porque el 100% se va a FC Ramos.

**Causa raíz:** `reglas_apertura` no tiene ninguna columna de origen. La identidad de una regla es
`nivel = 'concepto'` + `entidadId` (= código de concepto) + vigencia. `condicionComprasElegibles`
(`lib/apertura/motor.ts`) matchea **todas** las compras del concepto efectivo dentro de la
vigencia, sin filtrar por `localId` / `puntoDeVentaId`. El modelo `nivel` / `entidadId` se diseñó
para la jerarquía concepto → proveedor → registro, nunca para el local/PDV de origen.

**Comportamiento esperado (spec funcional, Etapa 2 ítem 2.7, textual):** *"Reglas de un PDV no se
replican a otro."* La regla aplica exclusivamente sobre los gastos del local/PDV de origen; los
demás locales no se ven afectados en ningún caso.

El origen puede ser un **PDV puntual** ("Bar Ramos Mejía") o un **local entero** (todos sus PDV) —
misma semántica que los destinos.

### 1.3 — Reglas no aplican a registros modificados manualmente (gap conocido)

**Falla observada (reproducida por el cliente):** un registro con concepto "Alquiler de
Herramientas" se cambia manualmente a "Alquiler". La regla de apertura definida para "Alquiler"
no se ejecuta sobre ese registro.

**Causa raíz:** `PATCH /api/dashboard/compras/[rowId]` actualiza `conceptoCodigoManual` (y los
otros overrides) y **no llama al motor de apertura**. El único camino que reevalúa reglas es
`sincronizarTrasImport` (`lib/apertura/reimportacion.ts`), que corre solo al final de un import de
Drive. Además, el PATCH rechaza con 409 cualquier edición sobre una compra con `esDistribuido =
true` (guard puesto en Fase D como política deliberada "hasta que Fase C/D lo resuelva" — nunca se
resolvió el caso de edición manual, solo el de reimport).

**Comportamiento esperado (cliente):** al editar un registro (en particular su concepto/proveedor),
se evalúan las reglas vigentes sobre su estado actual y se aplica la que corresponda. Si el
registro ya tenía una apertura aplicada por una regla anterior, se le quita esa y se le aplica la
que corresponda a su estado nuevo. La UI **avisa antes** de recalcular ("esto va a recalcular la
apertura de este registro, ¿confirmás?").

---

## 2. Alcance

**Dentro:**
- Origen (local / PDV) en `reglas_apertura`, con migración destructiva de reglas/distribuciones
  existentes (entorno dev).
- Filtrado del motor, validación de superposición, preview y UI del modal por origen.
- Indicador visual del concepto sensible al filtro de local/PDV del dashboard.
- Tooltip de composición en la celda mensual del concepto aperturado.
- Reevaluación puntual de una compra tras editarla manualmente, con confirmación en la UI.

**Fuera:**
- Nivel proveedor / registro individual de reglas (sigue reservado en el modelo, sin implementar).
- "Descartado" como concepto de negocio (indefinido — esperar aclaración del cliente).
- Cambio de forma de `v_compras_distribuidas` (el origen no aparece en la vista; la rama
  distribuida sigue mostrando local/PDV del **destino**).
- Backfill de reglas existentes (se borran; estamos en dev).
- Nuevas dependencias.

---

## 3. Modelo de datos y migración (#1.2)

### 3.1 — Schema

`reglas_apertura` suma dos columnas:

```prisma
model ReglaApertura {
  // ... campos existentes ...
  origenLocalId        Int?
  origenPuntoDeVentaId Int?
  origenLocal          Local?        @relation("reglaOrigenLocal", fields: [origenLocalId], references: [id])
  origenPuntoDeVenta   PuntoDeVenta? @relation("reglaOrigenPdv",   fields: [origenPuntoDeVentaId], references: [id])

  @@index([entidadId, nivel, origenLocalId, origenPuntoDeVentaId])
}
```

- CHECK a nivel base: `origenLocalId IS NOT NULL OR origenPuntoDeVentaId IS NOT NULL` — toda regla
  tiene origen.
- Semántica idéntica a `destinos_regla`: `origenPuntoDeVentaId` seteado → ese PDV puntual; solo
  `origenLocalId` → todo el local (todos sus PDV). Si el request trae solo PDV, el `localId` se
  resuelve antes de persistir (mismo helper que hoy usa `resolverLocalIdDestinos` en `motor.ts` —
  se generaliza o se agrega un gemelo `resolverLocalIdOrigen`).
- `Local` y `PuntoDeVenta` suman las relaciones inversas correspondientes.

### 3.2 — Migración (`prisma migrate dev`)

Un solo archivo de migración:
1. `ALTER TABLE reglas_apertura` agrega las dos columnas + las dos FK + el CHECK.
2. `DELETE FROM distribuciones_apertura;`
3. `DELETE FROM destinos_regla;`
4. `DELETE FROM reglas_apertura;`
5. `UPDATE compras SET "esDistribuido" = false, "distribuidoEn" = NULL WHERE "esDistribuido" = true;`

Los pasos 2–5 son válidos porque estamos en dev y las reglas se dan de baja. La data de compras
del ERP no se toca (solo los dos flags de apertura). `v_compras_distribuidas` no cambia.

**Requiere plan explícito en texto y confirmación del usuario antes de correr** (CLAUDE.md §7).

---

## 4. Motor: filtrado por origen (#1.2)

### 4.1 — `condicionComprasElegibles` (`lib/apertura/motor.ts`)

Recibe el origen de la regla (`origenLocalId`, `origenPuntoDeVentaId`) y agrega al WHERE:

```sql
AND (
  ( $origenPuntoDeVentaId IS NOT NULL AND c."puntoDeVentaId" = $origenPuntoDeVentaId )
  OR
  ( $origenPuntoDeVentaId IS NULL     AND c."localId"        = $origenLocalId )
)
```

Consecuencia deliberada: una compra con `localId` / `puntoDeVentaId` en `NULL` no matchea ninguna
regla — no hay forma de saber su origen y distribuirla a ciegas sería incorrecto. Un volumen alto
de compras así es señal de un problema de asignación de local aguas arriba, no de apertura.

### 4.2 — Callers

- `aplicarRegla` — pasa el origen desde la regla persistida a `condicionComprasElegibles`. Sin
  otro cambio: distribuciones, flush y `esDistribuido` quedan igual.
- `revertirRegla` / `revertirCompra` / `revertirCompras` — sin cambios (operan por `reglaId` /
  `rowId`).
- `sincronizarTrasImport` (`lib/apertura/reimportacion.ts`) — suma `origenLocalId` /
  `origenPuntoDeVentaId` al objeto que arma para `aplicarRegla`. Sin otro cambio: una compra nueva
  de un import solo cae en una regla si su local/PDV coincide con el origen.
- `GET /api/apertura/reglas/preview-total` — pasa el origen a `condicionComprasElegibles`, así el
  total previsualizado refleja solo las compras del origen elegido.

---

## 5. Validación de superposición por origen (#1.2)

Hoy `verificarSinSuperposicion` (`motor.ts`) bloquea dos reglas activas del mismo `entidadId` con
vigencias que se pisan. Ahora el conflicto es por **concepto + origen que compite + fechas que se
pisan**:

- Mismo concepto, orígenes que **no** compiten (ej. PDV Bar Ramos vs PDV Cancha San Justo) +
  fechas solapadas → **permitido**.
- Mismo concepto, orígenes que **sí** compiten + fechas solapadas → **bloqueado (409)**.

"Compiten" = misma lógica que `destinosSuperpuestos` en `lib/apertura/validaciones.ts`: mismo
local y (mismo PDV puntual, o al menos uno es "todo el local"). Se extrae/renombra a
`origenesSuperpuestos(a, b)` compartido (mismo shape `{ localId, puntoDeVentaId }`), o se reusa
`destinosSuperpuestos` directamente.

`verificarSinSuperposicion` pasa a:
1. Traer las reglas activas del mismo `entidadId` **cuyo origen se solapa** con el nuevo.
2. Sobre ese subconjunto, correr `encontrarSuperposicion` de fechas como hoy.

El mensaje del 409 aclara con qué regla y por qué origen chocó.

---

## 6. API y UI del modal: selector de origen (#1.2)

### 6.1 — Schemas (`lib/apertura/schemas.ts`)

- `crearReglaSchema` y la rama `editar` de `patchReglaSchema` suman `origenLocalId` /
  `origenPuntoDeVentaId`, con el mismo `refine` que `destinoSchema` (al menos uno no-null).
- `previewTotalQuerySchema` suma los mismos dos (con `z.coerce.number`).
- `validarCuerpoRegla` no cambia salvo por pasar el origen a la check de superposición (que vive
  en el route handler, como hoy).

### 6.2 — Route handlers

- `POST /api/apertura/reglas`, `PATCH /api/apertura/reglas/[id]`: persisten el origen en
  `reglaApertura.create` / `update`, lo pasan a `verificarSinSuperposicion` y a `aplicarRegla`.
- `GET /api/apertura/reglas`: el DTO (`ReglaAperturaDTO`, `lib/apertura/types.ts`) suma
  `origenLocalId` / `origenPuntoDeVentaId`.
- `GET /api/apertura/reglas/preview-total`: pasa el origen a `condicionComprasElegibles`.

### 6.3 — Modal (`components/dashboard/apertura-gastos-modal.tsx`)

- Nuevo estado `origen: { localId: number | null; puntoDeVentaId: number | null } | null`, en el
  formulario, arriba de `vigencia`.
- Nuevo componente `AperturaOrigenSelector` — single-select de local + PDV opcional; reusa la
  estructura de `AperturaDestinoRow` sin `%` / `$` y sin filas repetibles ("Local entero" vs "PDV
  puntual" con el mismo patrón `__todo_el_local`).
- `previewUrl` suma el origen a los query params; la key de caché de `apertura-preview-total` suma
  `origen.localId` / `origen.puntoDeVentaId`.
- `abrirFormularioNuevo` resetea `origen` a `null`; `abrirFormularioEditar` lo carga de la regla.
- Botón Guardar deshabilitado si `origen` no está completo (nuevo motivo en la lista "Falta:").
- Las cards de la lista de reglas suman una línea con el origen legible
  ("Origen: Bar Ramos Mejía" / "Origen: San Justo (todo el local)").

### 6.4 — Timeline de superposición (`components/dashboard/apertura-timeline.tsx`)

Muestra solo las reglas del concepto **cuyo origen se solapa** con el del formulario. Mientras
`origen` es `null`, no filtra (muestra todas, como hoy).

---

## 7. Indicador visual del concepto por origen (#1.2)

Hoy `pivot-table.tsx` arma `conceptosConReglaActiva` con
`reglas.filter(activa).map(entidadId)`. Pasa a considerar el filtro `localId` / `pdvId` de
`useDashboard()`:

- Sin filtro de local → el ícono se prende si el concepto tiene cualquier regla activa (como hoy).
- Con `pdvId` seteado → solo si hay una regla activa cuyo origen **alcanza** ese PDV (origen = ese
  PDV, o origen = "todo el local" de ese PDV).
- Con solo `localId` seteado → solo si hay una regla activa cuyo origen cae dentro de ese local.

La lógica de "alcanza" reusa `origenesSuperpuestos` (Sección 5). El DTO de la regla ya trae el
origen (Sección 6.2) — sin fetch nuevo.

---

## 8. Tooltip de composición (#1.1)

### 8.1 — Backend (`app/api/dashboard/pivot/route.ts`)

Segundo query (o CTE), bajo los mismos `conditions` que el query principal, sobre las compras
distribuidas visibles:
- Agrupa `distribuciones_apertura` por **concepto efectivo + mes + destinoId**.
- Devuelve por grupo: `SUM(importeCalculado)`, `porcentaje`, nombre del destino (JOIN a `locales`
  / `puntos_de_venta`), y el total "100%" del grupo concepto+mes.
- El total "100%" se calcula con `importeOriginal` **deduplicado por `compraRowId`** (en el
  fan-out, `importeOriginal` está repetido en las N filas de destino de una misma compra) —
  subquery `SELECT DISTINCT compraRowId, importeOriginal` sumado aparte, no `SUM` sobre el join.

`buildPivotData` cuelga en cada `PivotConceptoRow`:

```ts
composicion?: Record<
  number, // mes
  { total: number; destinos: { nombre: string; pct: number; importe: number }[] }
>
```

### 8.2 — Frontend (`components/dashboard/pivot-table.tsx`)

- Celda mensual del concepto: si `concepto.composicion?.[mes]` existe, se envuelve en un `Tooltip`
  (shadcn/radix, ya en el stack) con: línea `100% · $X` y una línea por destino
  `pct% Nombre $importe`.
- Sin apertura para ese mes → celda igual que hoy, sin tooltip.
- Solo la celda de **concepto** (no rubro, no proveedor).

---

## 9. Reevaluación al editar una compra (#1.3)

### 9.1 — `lib/apertura/reevaluacion.ts` (nuevo)

`reevaluarCompra(tx, rowId)`:
1. `revertirCompra(tx, rowId)` — borra las distribuciones de esa compra, `esDistribuido = false`.
2. Busca la regla activa que matchea el **estado nuevo** de la compra: `entidadId` = concepto
   efectivo, origen alcanza su `localId` / `puntoDeVentaId`, vigencia cubre su fecha efectiva. Por
   el invariante de no-superposición hay a lo sumo una.
3. Si hay una → `aplicarReglaACompra(tx, regla, rowId)` (nuevo, hermano acotado de `aplicarRegla`:
   calcula las distribuciones de **esa sola compra** con `calcularDistribuciones` y las inserta,
   marca `esDistribuido = true`). No se usa `aplicarRegla` a secas porque barrería todas las
   compras elegibles del concepto, no solo la editada.
4. Si no hay ninguna → la compra queda sin distribuir (correcto).

### 9.2 — `PATCH /api/dashboard/compras/[rowId]`

- Se **quita el guard 409** de `esDistribuido`.
- Todo el handler pasa a correr dentro de una `$transaction`: aplica el `update` y después
  `reevaluarCompra(tx, rowId)` — solo si cambió algún campo que afecta el matching
  (`importeManual`, `fechaManual`, `conceptoCodigoManual`); si solo cambió `observacManual`, se
  saltea la reevaluación.
- La respuesta suma `{ reevaluada: boolean; distribuidaAhora: boolean }`.
- Manejo de errores explícito (CLAUDE.md §2): cualquier fallo de `reevaluarCompra` hace rollback
  de toda la transacción (el update incluido) y devuelve 500 con mensaje — nunca se persiste el
  update dejando la distribución inconsistente.

### 9.3 — Frontend (`components/dashboard/compras-detalle-modal.tsx`)

- Se habilita el lápiz de edición para filas con `esDistribuido` / `distribucionId` (hoy
  deshabilitado con tooltip). La edición apunta siempre al `rowId` de la compra base.
- Al guardar, si la compra estaba distribuida **o** el concepto nuevo tiene regla activa →
  `ConfirmDialog` antes del PATCH: *"Esto va a recalcular la apertura de este registro según las
  reglas vigentes. ¿Confirmás?"*.
- Tras guardar OK: se invalida `["pivot"]`, `["detalle"]`, `["apertura-reglas"]`; toast que
  refleje `distribuidaAhora`.

### 9.4 — `sincronizarTrasImport`

Sin cambios. Sigue siendo el camino para reimportaciones masivas; `reevaluarCompra` es solo para
la edición manual puntual.

---

## 10. Testing

### 10.1 — Unitarios (vitest)

- `lib/apertura/validaciones.test.ts` — `origenesSuperpuestos`: PDV vs mismo PDV; PDV vs "todo el
  local" del mismo local; locales distintos; un lado null.
- `lib/apertura/motor.test.ts` — `condicionComprasElegibles` con origen: WHERE correcto para
  origen-PDV vs origen-local; compra con `localId` null nunca matchea.
- Superposición — dos reglas mismo concepto: orígenes que no compiten + fechas solapadas →
  permitido; orígenes que compiten + fechas solapadas → 409.
- `lib/apertura/reevaluacion.test.ts` (nuevo) — caso del cliente: compra concepto A sin regla →
  editar a concepto B con regla activa cuyo origen alcanza su PDV → queda distribuida con los % de
  B. Compra ya distribuida por regla A → editar a concepto sin regla → queda sin distribuir.
  Editar solo `observacManual` → no se toca la distribución.
- `aplicarReglaACompra` — invariante "suma de distribuciones = importe original, exacto" sobre una
  sola compra.
- `buildPivotData` — arma `composicion` correcta: dedupe de `importeOriginal` en el fan-out; suma
  de importes de destinos = total "100%".

### 10.2 — Fixtures

Reusar los casos numéricos ya definidos en la spec funcional (`$1.000.000 → 50/50`; reimport
`$1.200.000 → $600k/$600k`).

### 10.3 — Verificación manual pre-merge (dev)

1. Crear regla origen = PDV Ramos sobre "Alquiler" → confirmar que "Alquiler" de San Justo NO se
   toca.
2. Editar una compra de "Alquiler de Herramientas" → "Alquiler" → confirmar el `ConfirmDialog` y
   que la compra queda distribuida con los % de la regla.
3. Hover en una celda mensual de un concepto aperturado → tooltip con la composición completa,
   correcta, incluso con el dashboard filtrado por un local.

---

## 11. Orden de ejecución y checkpoints

1. **Migración + schema** (Sección 3) — plan explícito en texto + confirmación del usuario antes
   de `prisma migrate dev`. Única operación destructiva.
2. **Motor + validaciones + superposición** (Secciones 4, 5) — con tests.
3. **API + schemas + preview** (Sección 6.1–6.2).
4. **`reevaluacion.ts` + PATCH** (Sección 9.1–9.2) — con tests.
5. **Modal: selector de origen + timeline filtrada** (Secciones 6.3–6.4).
6. **Indicador del concepto por origen** (Sección 7).
7. **Tooltip de composición** (Sección 8) — backend pivot + frontend celda.
8. **Confirm dialog en compras-detalle-modal** (Sección 9.3).
9. `npm run lint` + `npm run build` + `vitest` + `verification-before-completion`.

Los pasos 1–4 y 8 tocan lógica sobre compras ya importadas. Como estamos en dev y las reglas se
dan de baja, la migración (paso 1) es la única operación destructiva y va con confirmación
explícita del usuario antes de correr.
