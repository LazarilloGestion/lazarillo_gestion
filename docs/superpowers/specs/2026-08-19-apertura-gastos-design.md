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

## 5. Procesamiento — síncrono optimizado, sin infraestructura nueva

No hay cola/worker en el stack (Vercel serverless, sin Redis/Inngest/QStash) y CLAUDE.md pide no sumar dependencias sin preguntar. La spec pide "procesar en back e informar que está trabajando" — se resuelve así:

- El route handler que crea/modifica una regla procesa todo en la misma request con `INSERT ... SELECT` en lote (mismo patrón que ya usa `normalizeCompras` con chunks, no fila por fila) — debería resolver en segundos incluso para "Histórico completo".
- El front usa una mutation de TanStack Query con estado `isPending` → indicador de "procesando" visible mientras dura el fetch. Cumple la UX pedida sin cola real.
- Riesgo aceptado: si algún concepto tiene un volumen inusualmente alto, podría acercarse al `maxDuration` de la función (a definir explícitamente, ver `app/api/etl/drive-import/route.ts` como referencia de `maxDuration = 60`). Si en la práctica algún concepto real se acerca al límite, se revisita esta decisión — no se sobre-diseña para un caso hipotético ahora.

## 6. Reimportación — protección del dato

Antes de que el ETL actualice una compra ya `esDistribuido = true`, compara el registro entrante contra el original almacenado:
- Idéntico → no se tocan las distribuciones.
- Distinto → se actualiza el original y se recalculan las distribuciones de esa compra sobre el nuevo importe, usando las reglas vigentes para su fecha.

El alcance exacto de "qué campos se comparan" no está cerrado en la spec (Juan señaló que no debería limitarse al importe) — se implementa comparando todos los campos ERP-controlados de la fila (los mismos que hoy se sobreescriben sin condición en el `ON CONFLICT`: `codCga`, `concepto`, `fecha`, `codigo`, `proveedor`, `detalle`, `observac`, `importe`, `impInt`, `imputac`, `per1/2/3`), no solo `importe`.

Límite explícito ya aceptado por la spec (sección 10.3): si el motor no tiene forma de identificar que un registro fue editado en el ERP (caso ya cubierto por la identidad partida de la sección 2, pero puede seguir fallando para las filas sin comprobante), no hay protección posible — Diego debe hacer esos cambios en el sistema en vez del ERP.

## 7. Reglas superpuestas y bloqueo

- Sin superposición de fechas por concepto — validado en el mismo route handler que crea/edita una regla, antes de persistir. Bloquea con mensaje claro si hay conflicto (pisar / arrancar desde donde termina la otra — decide el usuario, no automático).
- `esBloqueado = true` en una compra → el motor de apertura la omite siempre, en cualquier regla (creación, modificación, reimportación).
- Eliminar una regla revierte todas sus distribuciones (recalcula hacia atrás, borra filas de `distribuciones_apertura`, `esDistribuido = false` en las compras afectadas si no quedan otras reglas vigentes). Desactivar solo detiene aplicación futura — el historial de `distribuciones_apertura` ya generado queda intacto.

## 8. UI

- **Acceso al modal:** ícono chico junto al nombre del concepto en la tabla del dashboard (mismo lenguaje visual que el ícono de engranaje de "Conceptos visibles" en `rubros-config-modal.tsx`), separado del área que hoy abre el detalle (`openDetalle`) y del ícono de expandir fila (`ExpandableButton`) — ver `components/dashboard/pivot-table.tsx`.
- Modal: concepto (solo lectura), lista de destinos con selector local/PDV + % + $ bidireccional, total % en tiempo real (rojo/verde según ≠/=100, mismo criterio de paleta que `RESULT_COLORS` en `lib/dashboard/resultados-calc.ts` si aplica visualmente), línea de tiempo de reglas existentes para detectar superposición, selector de vigencia con 4 modos, checkbox de extremos inclusivos, resumen legible antes de guardar.
- Indicador visual (%) junto al concepto/proveedor en el dashboard cuando la regla ≠ 100% — mismo criterio que el indicador de 2.9 ya descrito en `project_etapa2`.
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

### 10.1 Alcance cerrado de Fase B (brainstorming 24-ago-2026)

Dos puntos que este documento dejaba abiertos (fin de sección 10, punto 2) se cerraron con el usuario antes de escribir el plan ejecutable:

- **Sin UI en Fase B.** CRUD de `reglas_apertura`/`destinos_regla` vía route handlers únicamente, verificado con tests automatizados sobre los fixtures CA-01..CA-18 relevantes a motor/reglas — no una pantalla de prueba manual. La UI completa llega de una sola vez en Fase C.
- **Sección 7 (no-superposición + `esBloqueado`) entra en Fase B, no en Fase C.** Ambas son lógica de backend que ya tiene todo lo que necesita en Fase B (el route handler de crear/editar regla, el motor de aplicación) — la validación de superposición se implementa en el route handler (sin la línea de tiempo visual, que sigue siendo Fase C) y el motor ya salta `esBloqueado = true` desde el primer momento en que existe. Evita que Fase C tenga que volver a tocar el motor.

Alcance de Fase B en una línea: CRUD de reglas (con validación de suma=100%, no-superposición, `esBloqueado`) + motor síncrono de aplicación/reversión + vista `v_compras_distribuidas` + migración de `pivot`/`detalle` a leerla. Reimportación (sección 6) sigue siendo Fase D; UI (modal, línea de tiempo visual, indicador) sigue siendo Fase C.

## 11. Riesgos y puntos abiertos

- El alcance exacto de la comparación de campos en reimportación (sección 6 de este doc / 10.3 de la spec funcional) no está cerrado — se implementa con el criterio más amplio razonable (todos los campos ERP-controlados) pero puede necesitar ajuste con datos reales.
- La migración de `rowId` es la operación de mayor riesgo de todo el plan — toca compras ya importadas en producción. Requiere aprobación explícita antes de ejecutar (no solo antes de escribir el script).
- Si en la práctica alguna regla "Histórico completo" resulta afectar un volumen que se acerca al timeout de la función serverless, revisitar la decisión síncrona de la sección 5 (no se sobre-diseña ahora para ese caso).
