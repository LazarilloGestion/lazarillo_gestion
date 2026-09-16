# Apertura de Gastos — Fase 2: niveles Proveedor y Registro Individual

## Contexto

La Especificación Apertura de Gastos v2 (19 páginas, reuniones 6 y 12-ago-2026 — ver memoria `project_apertura_gastos_spec`) define una jerarquía de 3 niveles de reglas de apertura, con prioridad **registro individual > proveedor > concepto**, y exige explícitamente que "la arquitectura debe contemplar los 3 niveles desde el diseño inicial" aunque solo el nivel `concepto` se implementó en v1 (Fases A-D, ya en producción). El schema ya refleja esto: `ReglaApertura.nivel`/`entidadId` son campos genéricos (`prisma/schema.prisma:315`), no específicos de concepto.

La vista "Compras por Proveedor" (Proveedor → Concepto → línea), implementada en una fase anterior, dejó preparado el nivel 0 del árbol como "punto de enganche natural" para reglas de proveedor, pero explícitamente no implementó ninguna regla nueva — solo la reorganización de la vista.

Esta fase implementa los dos niveles postergados: **proveedor** y **registro individual**, generalizando el motor de reglas existente (`lib/apertura/`) que hoy asume `nivel: "concepto"` en 3 lugares (`motor.ts`, `reevaluacion.ts`, `app/api/apertura/reglas/route.ts`).

## Objetivo

- Permitir crear reglas de apertura a nivel **proveedor** (todas las compras de un proveedor, con la misma semántica de vigencia/destinos que concepto) y a nivel **registro individual** (una compra puntual, sin vigencia — un override directo).
- Resolver correctamente la prioridad `registro > proveedor > concepto` cuando una compra matchea reglas de más de un nivel, sin duplicar ni perder importe distribuido.
- No introducir tablas nuevas ni cambios de schema — el modelo de datos ya es genérico.

## Alcance

**Incluye:**
- Generalización del motor (`lib/apertura/motor.ts`, `reevaluacion.ts`, `validaciones.ts`) para operar sobre los 3 niveles con resolución de prioridad.
- UI: ícono "Aperturar" en la fila de proveedor (mismo patrón que concepto) y en la fila de registro individual (mismo ícono, oculto por default, revelado al hover o si ya tiene regla propia activa).
- Modal de apertura parametrizado por nivel: para registro individual, sin sección de vigencia.
- Reimportación: generalizar la comparación existente para disparar re-resolución de prioridad cuando cambia un campo que participe en el matching de cualquier nivel (hoy solo mira concepto).
- Tests de regresión para los 18 CA existentes (nivel concepto) + fixtures nuevos para escenarios de prioridad entre niveles (ver sección Testing).

**No incluye (fuera de alcance):**
- Cambios a la UI/lógica de "Disponible en caja", "Diferencia de caja" u otras filas del dashboard no relacionadas a apertura.
- El caso de "empleado cargado como proveedor en el ERP" que menciona la spec v2 no recibe tratamiento especial — una regla de proveedor es una regla de proveedor, sea empresa o persona; no hay UI ni validación distinta para ese caso.
- Ningún cambio al nivel `concepto` más allá de generalizar su matching para pasar por la misma función de resolución de prioridad que los otros dos niveles — su comportamiento observable no cambia.

## Arquitectura

### 1. Modelo de datos (sin migración)

`entidadId` (`String`) se codifica según `nivel`:
- `"concepto"` → código de `ConceptoCaja` (sin cambios).
- `"proveedor"` → `String(proveedor.id)`.
- `"registro"` → `compra.rowId` (ya es `String`, es la PK de `Compra`).

`DestinoRegla` y `DistribucionApertura` no cambian — son agnósticas al nivel de la regla que las originó. `DistribucionApertura.reglaId` ya identifica qué regla ganó para cada compra; no hace falta ninguna tabla nueva de auditoría/resolución.

Una regla de `nivel: "registro"` no usa `modo`/`fechaDesde`/`fechaHasta`/`extremosInclusivos` — esos campos permanecen nullable/con default en el schema (ya lo son o pueden serlo sin migración destructiva), y la capa de validación (`lib/apertura/schemas.ts`) los ignora para este nivel en vez de exigirlos.

### 2. Motor — resolución de prioridad

Función nueva `resolverReglaGanadora(compra): ReglaApertura | null` en `lib/apertura/motor.ts`. Dado el `conceptoCodigoManual ?? conceptoCodigo`, `proveedorId` y `rowId` de una compra (y su origen — `localId`/`puntoDeVentaId`), busca reglas `estado: "activa"` y vigentes (misma condición de vigencia temporal que hoy, `modo`/`fechaDesde`/`fechaHasta`) en los 3 niveles con el mismo origen, y devuelve la de mayor prioridad que matchee: primero busca por `nivel: "registro"` (`entidadId = rowId`), si no hay busca `nivel: "proveedor"` (`entidadId = String(proveedorId)`), si no hay busca `nivel: "concepto"` (`entidadId = conceptoEfectivo`). Devuelve `null` si ninguna aplica. Un registro con `esBloqueado: true` nunca entra a esta resolución (se corta antes, para cualquier nivel).

`condicionComprasElegibles` (hoy hardcodea `COALESCE(c."conceptoCodigoManual", c."conceptoCodigo") = ${entidadId}`) se generaliza a un predicado por `nivel`:
- `concepto` → la condición actual, sin cambios.
- `proveedor` → `c."proveedorId"::text = ${entidadId}`.
- `registro` → `c."rowId" = ${entidadId}`.

Toda operación que hoy "aplica" una regla a compras (crear, editar destinos/vigencia, activar, desactivar, eliminar) deja de asumir que la regla que se está tocando es la que corresponde a cada compra candidata. En vez de eso, para cada compra candidata (las que matcheaban ANTES o DESPUÉS del cambio, unión de ambos conjuntos): revierte sus distribuciones actuales (reutiliza la lógica de reversión que ya existe para "eliminar regla") y vuelve a llamar `resolverReglaGanadora`, aplicando la que gane (si alguna). Esto reemplaza la relación 1 a 1 "esta regla → estas distribuciones" de v1 por una resolución de 3 niveles en cada compra tocada — es la única generalización de comportamiento real respecto a v1; todo lo demás (validación de %, importe original inmutable, idempotencia) no cambia.

### 3. Reevaluación

`lib/apertura/reevaluacion.ts` hoy dispara cuando cambia `conceptoCodigoManual` de una compra (único campo editable que afecta matching). Generalización:
- **Concepto**: el trigger existente pasa a llamar `resolverReglaGanadora` en vez de buscar directo `nivel: "concepto"` — mismo evento disparador, resolución generalizada.
- **Proveedor**: sin trigger por edición manual — `Compra.proveedorId` no tiene override manual (`proveedorIdManual` no existe en el schema), así que este eje solo cambia por creación/edición/baja de reglas de proveedor, ya cubierto por la sección 2.
- **Registro**: sin "cambio de campo" que dispare nada — el único evento relevante es crear/editar/borrar la regla misma (sección 2).

**Reimportación**: el pipeline existente (compara el registro entrante contra el guardado, recalcula si difiere) se generaliza para disparar `resolverReglaGanadora` si cambió cualquier campo que participe en matching de algún nivel (concepto o proveedor — `rowId` es la PK, nunca cambia).

### 4. Validaciones

- **No superposición de vigencia**: sigue siendo por `(nivel, entidadId, origen)` — dos reglas de *proveedor* para el mismo proveedor no pueden superponerse entre sí, pero una regla de proveedor y una de concepto sí pueden coexistir en las mismas fechas sin bloquear la creación (la prioridad los resuelve en runtime vía `resolverReglaGanadora`, no en la validación de creación).
- **Registro individual**: sin vigencia — el formulario para este nivel omite modo/fechas/extremos inclusivos; concepto y proveedor se muestran de solo lectura (derivados de la compra), y la única entrada del usuario es la lista de destinos.
- **`esBloqueado`**: sigue siendo agnóstico al nivel — ya lo es hoy, sin cambios.

### 5. UI

- Ícono `Split` (mismo componente/patrón que ya existe en la fila de concepto): se agrega a la fila de proveedor (nivel 0 del árbol "Compras por Proveedor", siempre visible como hoy en concepto) y a la fila de registro individual (nivel más profundo, en ambos árboles) con `opacity-0 group-hover:opacity-100` para no sumar peso visual en filas que pueden ser cientos — visible sin hover únicamente si ese registro puntual ya tiene una regla de registro activa (mismo criterio de "resaltar si tiene regla" que usa concepto hoy vía `conceptosConReglaActiva`).
- El click del ícono usa `stopPropagation` — en la fila de proveedor y concepto no hay conflicto (el ícono ya convive ahí); en la fila de registro individual tampoco compite con nada, porque el único `onClick` existente en esa fila vive en las celdas de valores mensuales (abre `CompraLineasModal`), no en la celda de label donde va el ícono nuevo.
- `AperturaGastosModal` se parametriza por `nivel`: para concepto/proveedor mantiene vigencia y destinos sin cambios; para registro individual omite la sección de vigencia (aplica de inmediato, sin fecha) y el encabezado muestra el detalle de esa compra puntual (proveedor, concepto, importe, fecha) en vez de un código de concepto/proveedor de solo lectura.
- Indicador de "regla activa" en la fila de proveedor/concepto: sigue marcándose activo aunque una regla de registro individual le haya ganado a alguna de sus compras puntuales (una regla de proveedor "existe y aplica", independientemente de que una más específica gane en un caso puntual — ruling confirmado durante el brainstorming).

## Manejo de errores

- Prioridad de orden total fijo (`registro > proveedor > concepto`) — nunca hay ambigüedad ni necesidad de desempate.
- `esBloqueado` corta la resolución antes de considerar ningún nivel, para cualquier compra.
- La resolución nunca es recursiva (una compra se resuelve contra reglas, nunca contra otras compras) — no hay riesgo de loop.
- Igual que en v1: ningún `catch {}` vacío, toda operación de aplicar/revertir corre en una transacción de Prisma para que un fallo a mitad de camino no deje distribuciones parciales (mismo criterio que ya usa el motor de concepto).

## Testing

- Los 18 CA existentes de nivel concepto (spec v1) siguen como regresión sin tocar — `resolverReglaGanadora` con una sola regla activa (concepto) debe comportarse idéntico al motor viejo.
- Fixtures nuevos, con montos concretos (siguiendo el estilo de los CA existentes):
  1. Compra con regla de concepto Y de proveedor simultáneas y vigentes → gana proveedor.
  2. La misma compra, sumándole una regla de registro individual → gana registro.
  3. Se borra la regla de registro → la compra recalcula contra la regla de proveedor (no vuelve al importe original si proveedor sigue activa).
  4. Se crea una regla de proveedor sobre compras que ya tenían distribuciones de una regla de concepto preexistente → migran correctamente (revierte concepto, aplica proveedor), sin duplicar ni perder importe — validar invariante suma(distribuciones) = importe original en cada paso.
  5. Reimportación que trae un `proveedorId` distinto para una compra existente → dispara re-resolución, no solo recalculo de importe.
  6. Modal de registro individual: guardar sin ningún campo de vigencia no debe fallar validación (el schema para este nivel no los exige).

## Riesgos conocidos

- La generalización del motor (sección 2) es el corazón del cambio y el punto de mayor riesgo — toca código que hoy corre en producción sobre datos financieros reales. El plan de implementación debe secuenciar esto con tests de regresión de los 18 CA existentes corriendo en verde ANTES de tocar `condicionComprasElegibles`, y de nuevo después de cada paso.
- "Aplicar/revertir" para cada compra candidata en cascada (sección 2) puede volverse costoso si una regla de proveedor amplia (ej. sin filtro de fecha, "histórico completo") afecta miles de compras — igual que ya es una operación pesada hoy a nivel concepto (de ahí el procesamiento async ya decidido en la spec v2). No es un riesgo nuevo, pero el plan debe confirmar que el mismo mecanismo de background/progreso ya usado para concepto se reutiliza sin cambios para proveedor/registro.
- Dado que esta feature toca datos de compras ya importados y reglas de negocio financieras ("Muy alta" complejidad por clasificación del proyecto), CLAUDE.md sección 7 exige preguntar antes de ejecutar cualquier paso que modifique esos datos — el plan de implementación debe respetar esto explícitamente en cada tarea que corra el motor contra la base real, y `subagent-driven-development`/`dispatching-parallel-agents` no pueden ejecutar esos pasos de forma autónoma (excepción explícita de CLAUDE.md sección 9.1).
