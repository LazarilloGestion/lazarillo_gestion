# Apertura de Gastos / Prorrateo — Diseño técnico

- **Fecha:** 2026-08-19
- **Estado:** propuesto, pendiente de writing-plans
- **Fuente funcional:** memoria de proyecto `project_apertura_gastos_spec.md` (Especificación Funcional v2, cliente Diego Albo, reuniones 6 y 12-ago-2026). Este documento traduce ese contrato de comportamiento a un diseño técnico para el stack actual (Next.js 16 + Prisma 7/`adapter-pg` + Supabase + TanStack Query, sin `react-hook-form` ni `@tanstack/react-table`).
- **Clasificación:** ítem 2.7 de Etapa 2, complejidad **Muy alta** (único ítem en ese nivel; 2.9 y 2.10 dependen de que esté estable).

## 1. Alcance de esta versión

Implementa **solo el nivel "concepto de caja"** de la jerarquía de 3 niveles que define la spec (concepto → proveedor → registro individual). Proveedor y registro individual quedan postergados, pero el modelo de datos (`nivel`, `entidad_id` en `reglas_apertura`) los contempla desde el diseño para no requerir rediseño estructural después.

**Fuente de datos:** tabla 14 de compras (`Compra`). La tabla de pagos (informe 80, ver switch Económico/Financiero a cotizar) queda fuera de este plan — se acoplará como trabajo adicional una vez que el motor esté estable, reusando las mismas reglas.

**Fuera de alcance de este plan:** niveles 2 y 3 de apertura, integración con tabla de pagos, pausa temporal de regla (la spec ya resolvió no implementarla).

## 2. Identidad de compra — rediseño de `rowId`

### El problema
El `rowId` actual (`lib/etl/normalizers/compras.ts`) es un hash de `COD_CGA + FECHA + CODIGO + CONCEPTO + DETALLE + OBSERVAC + IMPORTE`. Incluir `IMPORTE` fue una decisión deliberada anterior para no perder transacciones genuinamente distintas con los mismos campos descriptivos. Pero esto choca con el principio de reimportación de la spec (sección 10, CA-11/CA-12): si el ERP corrige el importe de un gasto ya cargado, el sistema actual no lo trata como una actualización del mismo registro — genera una fila nueva, y la vieja queda huérfana con sus distribuciones (si las tuviera) desincronizadas.

El ERP (tabla 14) no expone ningún ID interno propio — se confirmó revisando `lib/etl/schemas/compras.ts`, no hay columna sin usar que sirva de identidad estable.

### Diseño: identidad partida
- **Filas con comprobante parseable** (~60% del histórico, gastos con factura — comprobante se deriva de `DETALLE` vía `parseComprobanteFromDetalle`): `rowId` = hash de `COD_CGA + FECHA + CODIGO + CONCEPTO + comprobante`, **sin `IMPORTE`**. Un cambio de importe en el ERP para el mismo comprobante ahora es un update al mismo registro.
- **Filas sin comprobante** (~40%, sueldos/alquiler/gastos sueltos): se mantiene el hash actual con `IMPORTE` incluido. No hay forma de distinguir de otro modo una corrección de una transacción distinta con los mismos campos descriptivos, así que se preserva la protección anti-pérdida ya existente.

### Migración de datos existentes
**Corrección post-diseño (detectada en writing-plans, 2026-08-19):** el hash actual usa el número de serie crudo de Excel para `FECHA` (ej. `45000`), no un string ISO. El script de migración solo tiene acceso al `Date` ya parseado de cada compra existente (no al serial original), así que no puede reproducir ese formato. Para que el mismo archivo reimportado en el futuro produzca el mismo `rowId` que el que le asignamos en la migración, `FECHA` se canonicaliza como ISO (`YYYY-MM-DD`) en **las dos ramas** del hash (con y sin comprobante) — no solo en la rama con comprobante. Consecuencia: se migran **las ~9.508 compras del histórico completo**, no solo las ~5.700 con comprobante. No cambia el enfoque (identidad partida sigue igual), solo el alcance de filas tocadas por la migración.

Pasos:
1. Backup completo de `compras` y `detalle_compras` antes de tocar nada (mismo patrón que `scripts/reset-db.ts` ya usa para overrides).
2. Script de migración (`scripts/migrate-rowid-compras.ts`, ejecución manual con confirmación explícita — **no correr sin aprobación directa**, toca compras/ventas ya importadas, CLAUDE.md sección 7): para cada compra con comprobante, calcular el `rowId` nuevo y actualizar `compras.rowId`.

**Corrección (detectada en subagent-driven-development, revisión final, 2026-08-19):** esta sección decía "no hay FK real [entre `detalle_compras.compraId` y `compras.rowId`] — es texto suelto, hay que [actualizar `detalle_compras`] a mano". Eso está mal — es una confusión con el hallazgo de `project_alta_nunez_comercio` (que sí aplica a `localId`/`puntoDeVentaId`, columnas realmente sin FK). La relación `detalle_compras.compraId → compras.rowId` **sí tiene FK real, con `ON UPDATE CASCADE`** (`prisma/migrations/20260504151051_init/migration.sql`) — un solo `UPDATE compras SET "rowId" = ...` ya propaga el cambio a `detalle_compras` automáticamente a nivel de base. Intentar actualizar `detalle_compras.compraId` a mano ANTES que `compras.rowId` viola la FK (apunta a un rowId que todavía no existe) y aborta la migración a mitad de camino contra producción — este fue precisamente el bug Critical que encontró la revisión final del plan de Fase A, ya corregido en el script. Verificar siempre las FK reales del schema antes de asumir que una relación no está garantizada por la base.
3. Verificación post-migración: mismo total de filas en `compras` y `detalle_compras`, mismo `SUM(importe)`, ningún `detalle_compras.compraId` huérfano.
4. El ETL (`normalizeCompras`) pasa a calcular `rowId` con la lógica partida a partir de ese momento — coexiste sin problema con las filas ya migradas.

## 3. Modelo de datos

Nombres de tabla y columna en español, consistente con el schema existente (exigencia explícita del cliente).

```prisma
model ReglaApertura {
  id          Int      @id @default(autoincrement())
  nivel       String   // 'concepto' en v1; 'proveedor' | 'registro' reservados
  entidadId   String   // código de ConceptoCaja en v1
  modo        String   // 'historico' | 'entre_fechas' | 'desde_adelante' | 'desde_atras'
  fechaDesde  DateTime?
  fechaHasta  DateTime?
  extremosInclusivos Boolean @default(true)
  estado      String   @default("activa") // 'activa' | 'inactiva'
  creadoPor   String?
  creadoEn    DateTime @default(now())

  destinos       DestinoRegla[]
  distribuciones DistribucionApertura[]

  @@index([entidadId, nivel])
  @@map("reglas_apertura")
}

model DestinoRegla {
  id             Int      @id @default(autoincrement())
  reglaId        Int
  localId        Int?
  puntoDeVentaId Int?
  porcentaje     Decimal  @db.Decimal(5, 2)

  regla         ReglaApertura @relation(fields: [reglaId], references: [id])
  local         Local?        @relation(fields: [localId], references: [id])
  puntoDeVenta  PuntoDeVenta? @relation(fields: [puntoDeVentaId], references: [id])

  @@map("destinos_regla")
}

model DistribucionApertura {
  id               Int      @id @default(autoincrement())
  compraRowId      String
  reglaId          Int
  destinoId        Int
  importeOriginal  Decimal  @db.Decimal(14, 2)
  porcentaje       Decimal  @db.Decimal(5, 2)
  importeCalculado Decimal  @db.Decimal(14, 2)
  procesadoEn      DateTime @default(now())

  compra  Compra        @relation(fields: [compraRowId], references: [rowId])
  regla   ReglaApertura @relation(fields: [reglaId], references: [id])
  destino DestinoRegla  @relation(fields: [destinoId], references: [id])

  @@index([compraRowId])
  @@map("distribuciones_apertura")
}
```

Campos nuevos en `Compra`:
```prisma
esDistribuido Boolean   @default(false)
distribuidoEn DateTime?
esBloqueado   Boolean   @default(false)
```

Todo vía migración de Prisma — nunca a mano (CLAUDE.md sección 6).

## 4. Materialización — solo cuando hay regla aplicable

No se genera una distribución trivial 100% para cada compra sin regla — sería duplicar el 100% del histórico sin ganar nada (viola YAGNI). `distribuciones_apertura` solo tiene filas para compras efectivamente cubiertas por una regla activa.

**Vista SQL centralizada** (`v_compras_distribuidas`), `UNION ALL` de:
- Compras con `esDistribuido = false` → su propia fila, igual que hoy (`localId`, `puntoDeVentaId`, `importe`/`importeManual`).
- Compras con `esDistribuido = true` → sus N filas desde `distribuciones_apertura` (local/PDV del destino, `importeCalculado` en vez de `importe`).

De los 5 endpoints que hoy leen `compras` directo, solo 2 migran a la vista:
- `app/api/dashboard/pivot/route.ts` y `app/api/dashboard/detalle/route.ts` (agregan/filtran por local → necesitan el fan-out).
- `app/api/dashboard/compras/[rowId]/route.ts`, `app/api/dashboard/compra-lineas/[compraId]/route.ts`, `app/api/search/observaciones/route.ts` no cambian de forma — el registro puntual sigue siendo el original; se suma metadata de desglose (destinos + porcentajes) cuando `esDistribuido = true`.

`buildPivotConditions` (`lib/dashboard/query-builders.ts`) no cambia su forma — solo el `FROM` de las dos queries que la usan pasa de `compras c` a `v_compras_distribuidas c`.

**Corrección (detectada en writing-plans, 19-ago-2026):** esta sección asumía que `detalle` ya usaba `buildPivotConditions`/SQL crudo igual que `pivot`. Un refactor posterior a la fecha de este diseño (commit `e2a50b0`, "separa lógica de negocio de UI y cachea lecturas con TanStack Query") cambió `app/api/dashboard/detalle/route.ts` a usar el cliente tipado de Prisma (`prisma.compra.findMany` con `where: Prisma.CompraWhereInput` y `select` con relaciones anidadas — `proveedorRef`, `local`, `puntoDeVenta`, `conceptoCaja`, `conceptoCajaManual`), no SQL crudo. Migrar `detalle` a la vista requiere reescribirlo a SQL crudo (mismo patrón que `pivot`: `$queryRaw` + `LEFT JOIN` a `proveedores`/`locales`/`puntos_de_venta`/`conceptos_caja` x2, reconstruyendo en JS la forma anidada que ya consume el frontend, `CompraDetalle` en `lib/dashboard/types.ts`) — no es un cambio trivial de una línea en el `FROM` como se asumía originalmente. El plan de Fase B lo trata como su propia tarea.

**Columnas de la vista:** mismos nombres/tipos que `compras` (`"rowId"`, `"localId"`, `"puntoDeVentaId"`, `importe`, `"importeManual"`, `fecha`, `"fechaManual"`, `"conceptoCodigo"`, `"conceptoCodigoManual"`, `concepto`, `detalle`, `observac`, `"observacManual"`, `proveedor`, `"proveedorId"`) más `"distribucionId"` (nullable — `NULL` en la rama no distribuida, `distribuciones_apertura.id` en la fan-out), para que `buildPivotConditions` funcione sin modificar ni una línea. En la rama distribuida: `"localId"`/`"puntoDeVentaId"` vienen de `destinos_regla` (no de la compra original — es el punto del fan-out), `importe` es `distribuciones_apertura."importeCalculado"`, `"importeManual"` es siempre `NULL` (el override manual ya se usó como base del cálculo — sección 5 — así que `COALESCE("importeManual", importe)` en el consumidor resuelve solo, sin doble aplicación); `fecha`, `concepto`, `observac` y sus variantes manuales pasan sin cambios desde la compra original (la regla no cambia qué es el gasto, solo a dónde se imputa).

**Riesgo para Fase C (anotado, no resuelto acá):** una vez que existan reglas activas, una compra distribuida aparece en `detalle` como N filas que comparten el mismo `rowId` — el frontend (`compras-detalle-modal.tsx`) hoy asume `rowId` único por fila (React key, selección de línea). Fase B no toca ese componente (fuera de alcance, sin UI), pero Fase C deberá cambiar la key a `distribucionId ?? rowId` antes de que cualquier regla real esté activa en producción.

**Mismo riesgo en `pivot` (detectado en la revisión final de rama de Fase B, 19-ago-2026):** el diseño original solo anotó el caso de `detalle` — `pivot-table.tsx` tiene el mismo problema. Las filas de nivel-proveedor se construyen con `id: \`${concKey}|${row_id}\`` (`app/api/dashboard/pivot/route.ts`), y una compra distribuida en N destinos produce N filas con el mismo `row_id` bajo el mismo concepto → colisión de key de React en `pivot-table.tsx`. Además, el click de drill-down de esas filas (`openDetalle({ rowId: prov.rowId })`) sigue routeando al branch `?rowId=` de `detalle`, que lee `compras` directo (sin distribuir) — el modal mostraría el importe completo original, no la porción de la fila en la que el usuario hizo click. Fase C debe resolver ambos casos (`pivot` y `detalle`) juntos, no solo el de `detalle` que ya estaba anotado.

**Resolución (brainstorming Fase C, 19-ago-2026):** confirmado por lectura de código que el branch `?rowId=` de `detalle` se dispara por la sola presencia de `rowId` en el querystring, ignorando cualquier otro filtro que venga junto (`app/api/dashboard/detalle/route.ts:85-117`) — hoy siempre devuelve la compra completa sin distribuir, sin importar desde qué fila de fan-out del pivot se haya hecho click. Fix cerrado en la sección 10.2 de este documento: `pivot` empieza a traer `distribucionId` en su SELECT y en `PivotProveedorRow`, la key de fila lo incorpora, y el drill-down manda `distribucionId` junto con `rowId`; `detalle` acepta `distribucionId` opcional en el branch `?rowId=` — si viene, resuelve esa porción puntual contra `distribuciones_apertura`; si no viene, comportamiento actual intacto (usado hoy por `compra-lineas`/edición, que siempre operan sobre la compra completa).

**Riesgo para Fase C/D — overrides manuales sobre compras ya distribuidas (detectado en la revisión final de rama de Fase B):** `PATCH /api/dashboard/compras/[rowId]` (endpoint preexistente, fuera del alcance de cualquier task de Fase B) no tiene ningún guard contra editar `importeManual`/`conceptoCodigoManual` de una compra con `esDistribuido = true`. La vista `v_compras_distribuidas` ignora `importeManual` en la rama distribuida (usa `importeCalculado`), así que un importe corregido a mano se acepta, se persiste, se devuelve en la respuesta — y no tiene ningún efecto en los totales de `pivot`/`detalle`. Un cambio de `conceptoCodigoManual` es peor: desengancha silenciosamente la compra de la regla que la cubre (una regla nueva para el concepto nuevo la saltea, porque sigue `esDistribuido = true` de la regla vieja). **Política explícita hasta que Fase C/D resuelva esto: ninguna regla de apertura debe quedar activa en producción.**

**Decisión (brainstorming Fase C, 19-ago-2026):** la política se mantiene tal cual — Fase C se construye y verifica con reglas de prueba de bajo riesgo (mismo criterio que Fase A/B), pero no se usan reglas reales en producción hasta que Fase D cierre este gap. Sin guard ni bloqueo nuevo en el código de Fase C (evaluado y descartado — agregar un guard o feature-flag es más trabajo para un riesgo que ya se maneja por disciplina de uso, y Fase D es el lugar donde el guard real correspondería). Fase D pasa a ser prioridad inmediata después de Fase C, no una fase que pueda esperar indefinidamente.

**Riesgo menor para Fase C — edición de reglas inactivas:** `PATCH /api/apertura/reglas/[id]` con `accion: "editar"` revierte y reaplica las distribuciones de la regla sin tocar su `estado` — editar una regla `inactiva` la deja con distribuciones vivas pero `estado` sigue `"inactiva"`, invisible para el chequeo de superposición de cualquier regla futura. Sin caso de uso real todavía (sin UI que permita editar una regla inactiva), pero si Fase C expone esa acción, debe decidir explícitamente qué hacer con `estado` al editar (¿reactivar automáticamente? ¿bloquear la edición de reglas inactivas?).

**Resolución (brainstorming Fase C, 19-ago-2026):** reactivación automática. `accion: "editar"` deja `estado: "activa"` al final de la misma transacción, sin importar el estado previo — semántica del endpoint, no solo de la UI (cualquier caller que edite una regla la deja operativa). Ver sección 10.2.

## 5. Procesamiento — síncrono optimizado, sin infraestructura nueva

No hay cola/worker en el stack (Vercel serverless, sin Redis/Inngest/QStash) y CLAUDE.md pide no sumar dependencias sin preguntar. La spec pide "procesar en back e informar que está trabajando" — se resuelve así:

- El route handler que crea/modifica una regla procesa todo en la misma request con `INSERT ... SELECT` en lote (mismo patrón que ya usa `normalizeCompras` con chunks, no fila por fila) — debería resolver en segundos incluso para "Histórico completo".
- El front usa una mutation de TanStack Query con estado `isPending` → indicador de "procesando" visible mientras dura el fetch. Cumple la UX pedida sin cola real.
- Riesgo aceptado: si algún concepto tiene un volumen inusualmente alto, podría acercarse al `maxDuration` de la función (a definir explícitamente, ver `app/api/etl/drive-import/route.ts` como referencia de `maxDuration = 60`). Si en la práctica algún concepto real se acerca al límite, se revisita esta decisión — no se sobre-diseña para un caso hipotético ahora.

**Decisión (writing-plans, 19-ago-2026) — base efectiva, no solo dato crudo del ERP.** Ni la spec funcional ni este diseño cerraban cómo interactúa el motor con los overrides manuales que ya existen en el dashboard (`importeManual`, `conceptoCodigoManual`, `fechaManual` — feature previa, no forma parte de Apertura de Gastos). Confirmado con el usuario: el motor siempre lee el valor **efectivo** — `COALESCE(importeManual, importe)` como base del prorrateo, `COALESCE(conceptoCodigoManual, conceptoCodigo)` para decidir qué compras matchean una regla, `COALESCE(fechaManual, fecha)` para la ventana de vigencia — igual criterio que `pivot`/`detalle` ya usan hoy. Justificación: una compra que Diego ya reclasificó o corrigió a mano en el dashboard debe comportarse igual que se ve en pantalla, no según el dato crudo que el override reemplazó. `distribuciones_apertura.importeOriginal` guarda ese valor efectivo (no el importe crudo del ERP) — es "el importe sobre el que se calculó", consistente con el principio de la spec de nunca recalcular sobre un valor ya prorrateado.

## 6. Reimportación — protección del dato

**Cerrado en brainstorming de Fase D (20-ago-2026).** Ver también sección 10.3 (alcance cerrado) para el detalle de archivos/funciones.

Antes de que el ETL actualice una compra ya `esDistribuido = true`, compara el registro entrante contra el original almacenado:
- Idéntico → no se tocan las distribuciones.
- Distinto → se actualiza el original (comportamiento ya existente del `ON CONFLICT`) y se recalculan las distribuciones de esa compra sobre el nuevo importe efectivo, usando la regla vigente para su fecha.

**Campos comparados (decisión Fase D, resuelve la sección 10.3 de la spec funcional):** todos los campos ERP-controlados de la fila — los mismos que hoy se sobreescriben sin condición en el `ON CONFLICT`: `codCga`, `concepto`, `fecha`, `codigo`, `proveedor`, `detalle`, `observac`, `importe`, `impInt`, `imputac`, `per1/2/3`. Cualquier diferencia en cualquiera de estos dispara recálculo — no solo `importe`.

**Mecanismo — revertir + re-matchear, un solo camino de código:** no hay una rama separada para "cambió el importe" vs. "cambió el concepto". Para toda compra `esDistribuido = true` cuyos campos ERP cambiaron: se revierte su distribución puntual (`revertirCompra`, nueva función hermana de `revertirRegla` pero para una sola compra — borra sus filas de `distribuciones_apertura`, `esDistribuido = false`) y queda disponible para que la misma pasada de matching que ya corre `aplicarRegla` la vuelva a tomar. Si sigue cayendo en el concepto+vigencia de la misma regla (el caso típico: solo cambió el importe), se re-distribuye con el mismo % persistido sobre el importe nuevo — exactamente el ejemplo de la spec (CA: $1.000.000 → 50/50 → reimport a $1.200.000 → recalcula a $600k/$600k). Si el concepto o la fecha cambiaron de forma que ya no matchea esa regla, queda `esDistribuido = false` salvo que otra regla activa la cubra — es la consecuencia correcta de un dato que efectivamente cambió, no un estado inconsistente.

**Reglas activas también se aplican a compras nuevas de futuras importaciones** (spec funcional, "reglas activas se aplican automáticamente a registros que lleguen en futuras importaciones") — gap real detectado durante el brainstorming de Fase D: hoy `normalizeCompras` no tiene ningún hook hacia `lib/apertura/`, así que esto nunca pasaba. Se cierra con la misma pasada de matching de arriba: al final de cada import, `sincronizarTrasImport` (nuevo, `lib/apertura/reimportacion.ts`) corre `aplicarRegla` para **todas las reglas activas** — `aplicarRegla` ya filtra por `esDistribuido = false` dentro de concepto+vigencia, así que una compra nueva que cae en el período de una regla activa se distribuye en la misma pasada que recalcula las modificadas, sin necesidad de rastrear qué conceptos tocó el batch (ver sección 10.3, "por qué no filtrar por concepto tocado").

**Guard de overrides manuales (cierra el límite #1 de Fase B):** `PATCH /api/dashboard/compras/[rowId]` rechaza con 409 cualquier intento de editar `importeManual`/`fechaManual`/`conceptoCodigoManual`/`observacManual` sobre una compra con `esDistribuido = true` — todo-o-nada, no por campo (los tres primeros son justamente los que rompían la vista distribuida o desenganchaban la compra en silencio). El frontend refleja el mismo guard: `esDistribuido` se agrega al `select` del branch `(b)` (sin `distribucionId`) de `detalle/route.ts` — hoy ese campo ni siquiera se expone ahí — y `compras-detalle-modal.tsx` deshabilita Editar/Ver líneas cuando `item.distribucionId != null` **o** `item.esDistribuido === true` (antes solo cubría el primer caso).

Límite explícito ya aceptado por la spec: si el motor no tiene forma de identificar que un registro fue editado en el ERP (caso ya cubierto por la identidad partida de la sección 2, pero puede seguir fallando para las filas sin comprobante), no hay protección posible — Diego debe hacer esos cambios en el sistema en vez del ERP.

**Con Fase D cerrada, la política de Fase C ("ninguna regla real activa en producción", sección 4) queda técnicamente levantada** — el gap que la motivaba (overrides manuales sin guard) ya no existe. Activar la primera regla real sigue siendo una decisión de Diego, no automática por terminar el código.

## 7. Reglas superpuestas y bloqueo

- Sin superposición de fechas por concepto — validado en el mismo route handler que crea/edita una regla, antes de persistir. Bloquea con mensaje claro si hay conflicto (pisar / arrancar desde donde termina la otra — decide el usuario, no automático).
- `esBloqueado = true` en una compra → el motor de apertura la omite siempre, en cualquier regla (creación, modificación, reimportación).
- Eliminar una regla revierte todas sus distribuciones (recalcula hacia atrás, borra filas de `distribuciones_apertura`, `esDistribuido = false` en las compras afectadas si no quedan otras reglas vigentes). Desactivar solo detiene aplicación futura — el historial de `distribuciones_apertura` ya generado queda intacto.

## 8. UI

**Cerrado en brainstorming de Fase C (19-ago-2026).** Ver también sección 10.2 (alcance cerrado) y las "Resolución" agregadas en la sección 4 para los fixes de `pivot`/`detalle` y la reactivación automática al editar.

- **Acceso al modal:** ícono chico junto al nombre del concepto en la tabla del dashboard (mismo lenguaje visual que el ícono de engranaje de "Conceptos visibles" en `rubros-config-modal.tsx`), separado del área que hoy abre el detalle (`openDetalle`) y del ícono de expandir fila (`ExpandableButton`) — sibling dentro del mismo `<td>` que hoy envuelve `ExpandableButton` (`components/dashboard/pivot-table.tsx`, nivel concepto), no anidado dentro de ningún `<button>` existente.
- **Modal (`apertura-gastos-modal.tsx`):** título con el nombre del concepto (solo lectura). Cuerpo con dos vistas:
  - **Lista** (default al abrir): reglas existentes de ese `entidadId` (activas e inactivas — un concepto puede tener varias reglas no superpuestas en el tiempo), cada una como card con estado, resumen de vigencia, resumen de destinos (%), acciones `Editar` / `Activar`↔`Desactivar` / `Eliminar` (con confirmación, ya que elimina revierte distribuciones). Botón `+ Nueva regla`.
  - **Formulario** (crear o editar, mismo componente): selector de vigencia con los 4 modos + checkbox de extremos inclusivos (subcomponente `apertura-vigencia-selector.tsx`); lista de destinos repetibles, cada uno selector local/PDV + campo % + campo $ bidireccional (subcomponente `apertura-destino-row.tsx`); total % en tiempo real (rojo/verde, mismo criterio que `RESULT_COLORS.negative`/`.positive` de `lib/dashboard/resultados-calc.ts`); línea de tiempo de las reglas existentes de ese concepto para detectar superposición visualmente (subcomponente `apertura-timeline.tsx`, mismos datos que la vista Lista); resumen legible antes de guardar.
  - **Campo $ bidireccional:** el monto de referencia contra el que se calcula %↔$ viene de `GET /api/apertura/reglas/preview-total` (nuevo, ver 10.2), recalculado cada vez que cambia la vigencia elegida en el formulario — es el mismo total que después va a repartir el motor real (misma condición WHERE, compartida vía función extraída en `lib/apertura/motor.ts`), no una aproximación con datos ya visibles en el dashboard.
  - **Errores:** 409 de superposición se muestra referenciando el id de la regla en conflicto y lo resalta en la línea de tiempo; 422 de Zod mapea issues a mensajes por campo; errores de red/fetch vía el toast `notify` existente (mismo patrón que `rubros-config-modal.tsx`).
- **Indicador visual (%)** junto al concepto en `pivot-table.tsx` cuando ese concepto tiene ≥1 regla `activa` — mismo criterio que el indicador 2.9 descrito en memoria `project_etapa2` ("para explicar por qué un monto no coincide con el total original del comprobante", no una validación de suma de destinos, que siempre da 100%). Se alimenta del mismo fetch cacheado de `GET /api/apertura/reglas` que usa el modal (`useFetchQuery(["apertura-reglas"], ...)`, un solo fetch compartido, sin endpoint filtrado nuevo — volumen de reglas bajo, YAGNI).
- **`compras-detalle-modal.tsx`:** identidad de fila pasa de `rowId` a `distribucionId ?? rowId` (React key, estado `isEditing`). Filas con `distribucionId != null` deshabilitan `Editar`/`Ver líneas` (tooltip explicando por qué) — editar una porción distribuida no tiene semántica definida hasta que Fase D cierre el gap de overrides sobre compra distribuida.
- Sin librería de formularios nueva — `useState` + `zod` `safeParse` del lado servidor, como el resto del proyecto (CLAUDE.md sección 8).

## 9. Testing

Zona de mayor riesgo del proyecto (CLAUDE.md sección 4, TDD obligatorio para ETL/import vía skill `test-driven-development`). Los 18 criterios de aceptación de la spec (`CA-01` a `CA-18`) son los fixtures base — no reinventar casos, ya vienen con números concretos. Cobertura mínima:
- Migración de `rowId`: test de que el hash con/sin comprobante produce los valores esperados, y que el script de migración no pierde ni duplica filas (conteos antes/después).
- Motor de reglas: aplicación inmediata sobre registros existentes, recalculo sobre importe original (nunca sobre valor ya prorrateado), no-superposición, bloqueo de `esBloqueado`, eliminación vs. desactivación.
- Reimportación: sin cambio → no toca distribuciones; con cambio → recalcula.
- Vista `v_compras_distribuidas`: mismo total que sumar `compras` a mano para un período sin ninguna regla activa (regression check — la vista no debe alterar el comportamiento actual cuando no hay aperturas).

## 10. Orden de entrega propuesto

1. **Fase A — fundacional, sin cambios visibles al usuario:** migración de schema (tablas nuevas + campos en `Compra`) y migración de `rowId` con su script de verificación. Se puede desplegar y verificar en producción sin que el dashboard cambie de comportamiento.
2. **Fase B — motor + lectura:** CRUD de reglas a nivel concepto de caja (sin UI todavía, o UI mínima), aplicación síncrona, vista `v_compras_distribuidas`, migración de `pivot`/`detalle` a leer de la vista.
3. **Fase C — UI completa:** modal de creación/edición, línea de tiempo de superposición, indicador visual en dashboard, bloqueo de registros.
4. **Fase D — reimportación:** protección ante reimportación (comparación de campos, recalculo condicional).

Cada fase es un plan ejecutable independiente dentro de `writing-plans`/`executing-plans` — dado el tamaño total, no entra en un solo plan.

### 10.1 Alcance cerrado de Fase B (brainstorming 19-ago-2026, misma sesión que Fase A)

Dos puntos que este documento dejaba abiertos (fin de sección 10, punto 2) se cerraron con el usuario antes de escribir el plan ejecutable:

- **Sin UI en Fase B.** CRUD de `reglas_apertura`/`destinos_regla` vía route handlers únicamente, verificado con tests automatizados sobre los fixtures CA-01..CA-18 relevantes a motor/reglas — no una pantalla de prueba manual. La UI completa llega de una sola vez en Fase C.
- **Sección 7 (no-superposición + `esBloqueado`) entra en Fase B, no en Fase C.** Ambas son lógica de backend que ya tiene todo lo que necesita en Fase B (el route handler de crear/editar regla, el motor de aplicación) — la validación de superposición se implementa en el route handler (sin la línea de tiempo visual, que sigue siendo Fase C) y el motor ya salta `esBloqueado = true` desde el primer momento en que existe. Evita que Fase C tenga que volver a tocar el motor.

Alcance de Fase B en una línea: CRUD de reglas (con validación de suma=100%, no-superposición, `esBloqueado`) + motor síncrono de aplicación/reversión + vista `v_compras_distribuidas` + migración de `pivot`/`detalle` a leerla. Reimportación (sección 6) sigue siendo Fase D; UI (modal, línea de tiempo visual, indicador) sigue siendo Fase C.

### 10.2 Alcance cerrado de Fase C (brainstorming 19-ago-2026)

Alcance de Fase C en una línea: modal completo de creación/edición/gestión de reglas (lista + formulario + línea de tiempo), indicador visual (2.9) en el dashboard, fix de colisión de key/drill-down en `pivot`+`detalle`, reactivación automática al editar. Reimportación (sección 6, límite de overrides manuales) sigue siendo Fase D — Fase C no la incluye ni la bloquea con guards nuevos, ver "Resolución" en sección 4.

**Backend (3 cambios, ninguno es una fase de motor nueva):**
1. `GET /api/apertura/reglas/preview-total` (nuevo) — query params: `entidadId`, `modo`, `fechaDesde?`, `fechaHasta?`, `extremosInclusivos` (mismos campos/validación que `crearReglaSchema`, reusando `camposVigencia` de `lib/apertura/schemas.ts`). Devuelve `{ total: number }`. La condición WHERE (concepto efectivo vía `COALESCE`, `esBloqueado = false`, `esDistribuido = false`, ventana de vigencia vía `vigenciaToSql`) se extrae de `aplicarRegla` a una función compartida en `lib/apertura/motor.ts` (ej. `condicionComprasElegibles`) para que este endpoint y el motor real nunca puedan divergir.
2. `PATCH /api/apertura/reglas/[id]` con `accion: "editar"` — agrega `estado: "activa"` al `update` final dentro del mismo `$transaction` que ya revierte+reaplica, sin condicional sobre el estado previo.
3. Fix de colisión (`pivot`/`detalle`, detalle técnico ya en sección 4): `pivot/route.ts` agrega `c."distribucionId"` al SELECT y a `PivotProveedorRow`/`SqlRow` (`lib/dashboard/types.ts`); la key de fila de proveedor pasa a incluirlo; `openDetalle` en `pivot-table.tsx` manda `distribucionId` además de `rowId`. `detalle/route.ts` acepta `distribucionId` opcional en el branch `?rowId=`: presente → resuelve la porción puntual contra `distribuciones_apertura`/`destinos_regla`; ausente → comportamiento actual sin cambios.

**Frontend (componentes nuevos):**
- `components/dashboard/apertura-gastos-modal.tsx` (contenedor: vista Lista + vista Formulario) + `apertura-destino-row.tsx` + `apertura-vigencia-selector.tsx` + `apertura-timeline.tsx`.
- Cambios en `pivot-table.tsx` (ícono + badge + key/drill-down), `hooks/use-pivot-screen-data.ts` (`openDetalle` acepta `distribucionId` opcional), `lib/dashboard/params.ts` (`buildComprasDetalleUrl` agrega `distribucionId` al querystring si está presente), `compras-detalle-modal.tsx` (identidad de fila, deshabilitar acciones en filas distribuidas).
- Locales/PDV y lista de reglas se obtienen con `useFetchQuery` (mismo hook ya usado por `dashboard-filters.tsx`/`rubros-config-modal.tsx`), sin endpoints nuevos para ninguno de los dos.

**Testing:** el cálculo %↔$ bidireccional del campo de destino es lógica pura (dado un total y un % o un $, calcular el otro) — función chica con tests unitarios de vitest, ubicación a definir en el plan (ej. `lib/apertura/` o junto al componente). `condicionComprasElegibles` extraída del motor hereda la cobertura ya existente de `vigencia.ts` en lo que a construcción de condición de vigencia respecta; el endpoint de preview y los componentes en sí siguen el mismo split pure/impure de Fase B — sin DB de test, verificación manual gateada al final del plan (regla de prueba de bajo riesgo, igual criterio que Fase A/B, aprobación explícita en el momento).

### 10.3 Alcance cerrado de Fase D (brainstorming 20-ago-2026)

Alcance de Fase D en una línea: protección ante reimportación (comparación de todos los campos ERP-controlados + recálculo condicional vía revertir+re-matchear), auto-aplicación de reglas activas a compras nuevas en futuras importaciones, y guard 409 sobre edición manual sobre compra ya distribuida (cierra el límite #1 de Fase B). Ver detalle técnico completo en sección 6.

**Backend:**
1. `lib/etl/normalizers/compras.ts`: nueva función pura `camposErpCambiaron(anterior, nuevo): boolean` (los 12 campos ERP-controlados listados en sección 6). `normalizeCompras` trae la fila completa existente (no solo `rowId`) para las compras que ya estaban en la tabla, compara las `esDistribuido = true` antes/después del upsert, y devuelve un campo nuevo en su resultado: `comprasDistribuidasModificadas: string[]`.
2. `lib/apertura/motor.ts`: nueva función `revertirCompra(prisma, rowId)` — hermana de `revertirRegla`, alcance de una sola compra.
3. `lib/apertura/reimportacion.ts` (nuevo): `sincronizarTrasImport(prisma, comprasModificadas: string[])` — revierte cada compra modificada, después corre `aplicarRegla` para todas las reglas activas (idempotente, sin necesidad de filtrar por concepto tocado — ver "por qué no filtrar por concepto" abajo). Cada compra revertida y cada regla reaplicada corre en su propia `$transaction`, igual que el resto del motor; si una falla no aborta las demás, se acumulan errores y se devuelven en la respuesta del import (nunca se tragan en silencio).
4. `app/api/etl/drive-import/route.ts`: llama a `sincronizarTrasImport` una vez al final del batch (agregando `comprasDistribuidasModificadas` de todos los `report`s), mismo lugar donde hoy llama a `linkDetalleCompras`.
5. `app/api/dashboard/compras/[rowId]/route.ts`: guard 409 antes del `update` si `compra.esDistribuido === true` (ver sección 6).
6. `app/api/dashboard/detalle/route.ts`: agrega `esDistribuido` al `select`/objeto devuelto del branch `(b)` sin `distribucionId`.

**Por qué no filtrar por concepto tocado:** filtrar `sincronizarTrasImport` solo por los conceptos efectivamente tocados en el batch requeriría que `normalizeCompras` también devuelva esos conceptos y acoplaría más el ETL a apertura, para una optimización que no hace falta con el volumen esperado de reglas activas (unas pocas por concepto, no cientos). Si en el futuro esto se vuelve lento, se revisita — no se sobre-diseña ahora (mismo criterio YAGNI que la sección 5 sobre `maxDuration`).

**Frontend:** un solo cambio — `compras-detalle-modal.tsx` amplía su condición de deshabilitar Editar/Ver líneas a `item.distribucionId != null || item.esDistribuido === true`.

**Testing:** `camposErpCambiaron` y el diff de `normalizeCompras` llevan TDD completo con el `mock-db` existente (`lib/etl/test-utils/mock-db.ts`), mismo patrón que `compras.test.ts` — zona de mayor riesgo del proyecto (CLAUDE.md sección 4). `revertirCompra`/`sincronizarTrasImport` (SQL crudo) siguen el mismo criterio ya establecido en Fase B/C: sin DB de test separada, sin test de integración automatizado, verificación final controller-direct contra producción con una regla de bajo riesgo (reimportar un archivo modificando 1 compra ya distribuida, confirmar recálculo; importar un archivo con 1 compra nueva que cae en una regla activa, confirmar auto-aplicación) — aprobación explícita en el momento, mismo gate de CLAUDE.md sección 7/9.1 que las fases anteriores. El guard del PATCH se testea con Prisma mockeado si hay precedente de test de ruta en el repo, o queda cubierto en la misma verificación manual final si no lo hay — a confirmar en `writing-plans`.

**Fuera de alcance (deliberado):** `esBloqueado` sigue sin ninguna UI para setearlo — gap preexistente que esta fase no abre ni cierra. Niveles proveedor/registro individual de apertura siguen postergados.

## 11. Riesgos y puntos abiertos

- **Resuelto en Fase D** (ver sección 10.3): la comparación de campos en reimportación usa todos los campos ERP-controlados, no solo importe.
- La migración de `rowId` es la operación de mayor riesgo de todo el plan — toca compras ya importadas en producción. Requiere aprobación explícita antes de ejecutar (no solo antes de escribir el script).
- Si en la práctica alguna regla "Histórico completo" resulta afectar un volumen que se acerca al timeout de la función serverless, revisitar la decisión síncrona de la sección 5 (no se sobre-diseña ahora para ese caso).
- **Gap de testing del motor (Fase B):** el proyecto no tiene base de datos de desarrollo/test separada de producción (una sola instancia Supabase — ver memoria `project_lazarillo`). El motor se diseña separando cálculo puro (partición de porcentajes, condición de vigencia, detección de superposición — 100% testeable con vitest, sin DB) de los dos orquestadores que sí tocan la base (`aplicarRegla`, `revertirRegla` — SQL crudo, sin test automatizado posible sin una DB real). La verificación de esos dos orquestadores queda como paso manual gateado contra producción al final del plan de Fase B (crear una regla de prueba de bajo riesgo, verificar, revertir vía el mismo endpoint DELETE) — requiere aprobación explícita en el momento, igual que la migración de `rowId` de Fase A. Configurar una base de test/dev separada resolvería esto de raíz pero es una decisión arquitectónica aparte, no evaluada todavía (ver conversación pendiente sobre Supabase free-tier).
