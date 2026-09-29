# Reconciliación de identidad de compras ante ediciones del ERP post-carga

> Spec arquitectónica. No relacionada con el incidente de agosto (`docs/superpowers/specs/2026-08-21-limpieza-duplicados-compras-design.md`, causa raíz distinta: esquemas de `rowId` divergentes entre `main`/`dev`). Esto es un bug nuevo en el diseño vigente de `lib/etl/normalizers/compra-identity.ts`, reportado por el cliente (WhatsApp, 29-sep-2026).

## 1. Problema

`computeCompraRowId` calcula un hash de identidad a partir de campos del ERP (`codCga`, `fecha`, `codigo`, `concepto`, y — según si hay comprobante parseable — `comprobante`/`observac` o `detalle`/`observac`/`importe`). El ERP no exporta ningún identificador propio y estable por fila (`compraRowSchema` solo tiene campos descriptivos: `COD_CGA, FECHA, CONCEPTO, DETALLE, CODIGO, PROVEEDOR, OBSERVAC, IMPORTE, IMP_INT, IMPUTAC, PER1, PER2, PER3`) — el hash actúa como si fuera una clave estable, pero se calcula sobre campos que el ERP edita después de la carga inicial para la misma compra real. Cuando eso pasa, el hash cambia por completo y `INSERT ... ON CONFLICT("rowId")` no encuentra la fila vieja: inserta una nueva en vez de actualizarla.

**Dos mecanismos confirmados con evidencia real (queries de solo lectura, 29-sep-2026, 66.500 compras totales):**

1. **Comprobante aparece después.** El ERP carga la compra sin comprobante parseable (`DETALLE` vacío/"—") y más tarde la actualiza con el número real de factura. Eso cambia la rama del hash por completo (de la rama sin-comprobante, que incluye `detalle`+`importe`, a la rama con-comprobante, que incluye `comprobante` en su lugar). **50 grupos** — mismo `codCga+fecha+codigo+concepto+importe`, una fila con comprobante y una sin. Concentrado en Edenor (44/50, `codigo=68`) pero toca 6 proveedores distintos.
2. **OBSERVAC se edita con comprobante ya presente.** La rama con-comprobante también incluye `observac` en el hash — si el ERP corrige/completa ese texto para la misma compra (ej. `"Turbina Inflable"` → `"Turbina Inflable Nuevo"`, `"Cable Para Alargues Kids Park"` → `"...50%"`), también duplica. **4 grupos** — mismo `comprobante+codCga+fecha+codigo+concepto`, `importe` idéntico, `observac` distinto. Uno de los 4 ya tiene **una mitad con `esDistribuido=true`** (se le aplicó una regla de Apertura de Gastos a la fila equivocada del duplicado).

**Descartado explícitamente** (investigado, sin evidencia): cambios de `FECHA` para la misma compra real. La búsqueda inicial encontró cientos de grupos con mismo `concepto+importe` y `fecha` distinta, pero son transacciones recurrentes legítimas y distintas (ej. `"Cumple MOZO-COCINA"` $20.000 se repite genuinamente cientos de veces en fechas distintas) — no duplicados. Confirma que `FECHA` debe quedar exacta y obligatoria en cualquier criterio de match: relajarla generaría fusiones falsas entre compras reales.

**Verificado un caso que el diseño NO debe fusionar nunca**: `"Mochila Baño Vestuario"` vs `"Valvula + Tecla Descarga Baño"`, mismo `comprobante+codCga+fecha+codigo+concepto+importe` — es una factura real con 2 ítems distintos, no un duplicado.

## 2. Alcance

1. **Fix hacia adelante** en `normalizeCompras` (`lib/etl/normalizers/compras.ts`): reconciliar automáticamente, durante el import, una fila "nueva" (hash sin match) contra una fila existente que sea la misma compra real editada — en vez de insertarla como duplicado.
2. **Limpieza retroactiva** de los 54 grupos ya duplicados en producción (50 + 4), mismo patrón dry-run/backup/apply que el incidente de agosto.

**Fuera de alcance**: relajar `FECHA` en el match (sin evidencia, ver §1); Ventas (mismo criterio que agosto — su esquema de identidad no tiene este problema); cambios de schema Prisma (`rowId` sigue siendo el `@id` natural de `Compra`, solo cambia de *valor* en los casos reconciliados — ninguna migración).

## 3. Decisiones tomadas con el usuario

- Fix hacia adelante y limpieza retroactiva van en el mismo plan, no en entregas separadas.
- El script de limpieza elige el sobreviviente automáticamente (sin pedir confirmación caso por caso) — prioridad: nunca borrar una fila con `esDistribuido=true` si la otra mitad no lo tiene; en empate, gana el `OBSERVAC` más largo (el ERP agrega aclaraciones, no las saca). Como `importe`/`fecha` ya son idénticos por construcción del ancla de match, la elección de sobreviviente solo afecta qué texto descriptivo queda — nunca los totales.
- `FECHA` se mantiene exacta y obligatoria en el match (no se relaja) — más seguro dada la evidencia de §1.

## 4. Diseño

### 4.1 Ancla de reconciliación

Nueva función en `lib/etl/normalizers/compra-identity.ts`, reutilizando `CompraIdentityInput` (ya construido por `compraIdentityFromRawRow`/`compraIdentityFromDbRecord` — sin duplicar normalización):

```ts
export interface CompraAnchor {
  codCga: string | null;
  fechaISO: string | null;
  codigo: string | null;
  concepto: string | null;
  importe: string | null;
}

export function computeCompraAnchor(input: CompraIdentityInput): CompraAnchor {
  return {
    codCga: input.codCga,
    fechaISO: input.fechaISO,
    codigo: input.codigo,
    concepto: input.concepto,
    importe: input.importe,
  };
}
```

Match = igualdad exacta en los 5 campos. Si `importe` es `null`, no se intenta reconciliar (sin evidencia de duplicados con importe nulo — YAGNI). Es el subconjunto de campos común a ambos mecanismos confirmados en §1: ninguno de los 54 casos reales tiene el ancla distinta entre las dos mitades del duplicado.

### 4.2 Reconciliación durante el import (por chunk, `normalizeCompras`)

Para cada fila del chunk cuyo `rowId` recién calculado **no** esté en `existingMap` (hoy se contaría como `created`):

1. Buscar en la DB filas existentes cuyo ancla (§4.1) matchee, excluyendo las que ya están "reclamadas" en este mismo batch — su propio hash ya matchea (`existingMap`) o son el `rowId` recién calculado de otra fila del mismo chunk (evita que dos ítems legítimos de una misma factura, como el caso mochila/válvula, se pisen entre sí durante su primera carga).
2. **0 candidatos** → insertar normal (comportamiento actual).
3. **1 candidato** → reconciliar: `UPDATE compras SET "rowId" = <hash nuevo> WHERE "rowId" = <rowId viejo>`, ejecutado antes del `INSERT ... ON CONFLICT` del chunk — solo renombra la clave primaria, no hace falta setear el resto de los campos ahí: el mismo `INSERT ... ON CONFLICT` del chunk que ya va a correr a continuación incluye esta fila con el `rowId` nuevo entre sus `VALUES`, así que cae naturalmente en la rama `DO UPDATE` existente y actualiza `comprobante`/`detalle`/`observac`/etc. sin lógica duplicada. Las FK (`detalle_compras.compraId`, `distribuciones_apertura.compraRowId`) ya tienen `ON UPDATE CASCADE` (verificado en las migraciones) — no hace falta tocar hijos a mano. Se cuenta como `updated`, no `created`. Si la fila tenía `esDistribuido=true`, sigue pasando por `camposErpCambiaron`/`comprasDistribuidasModificadas` (mecanismo ya existente, sin cambios) — va a detectar el cambio y marcarla.
4. **≥2 candidatos** → ambiguo: no fusionar, insertar normal (mismo comportamiento actual) pero reportarlo — campo nuevo en `ETLReport`, `reconciliacionesAmbiguas: { rowIdNuevo: string; candidatos: string[] }[]` — visible en el reporte del import, no silencioso (§2 CLAUDE.md).

Nuevo campo en `ETLReport`: `comprasReconciliadas?: string[]` (rowIds viejos migrados), mismo espíritu que `comprasDistribuidasModificadas`.

### 4.3 Script de limpieza retroactiva

`scripts/reconciliar-duplicados-erp.ts` (nombre distinto del script de agosto — causa raíz distinta, no se reutiliza el mismo script). Mismo patrón: dry-run por default, `--apply` explícito.

**Función pura, testable sin DB**: `planReconciliacionDuplicados(compras: CompraParaReconciliar[]): PlanReconciliacion`, agrupando por el ancla de §4.1. Para cada grupo con más de 1 fila:

- Si el grupo no tiene exactamente 2 filas → excluir, motivo `"forma inesperada (no son 2 filas)"`.
- Contar cuántas de las 2 tienen `esDistribuido=true`:
  - **Exactamente 1** → esa es la sobreviviente; la otra es candidata a borrar.
  - **0** → sobrevive la de `OBSERVAC` más largo; si empatan en longitud → excluir el grupo, motivo `"empate de observac, revisar a mano"`.
  - **2** → excluir el grupo, motivo `"ambas filas tienen esDistribuido=true, revisar a mano"` (no observado en los datos actuales, cubierto por seguridad).
- Si la fila candidata a borrar tiene `detalle_compras` propio (`compraId` apuntándole) → excluir el grupo, motivo `"la fila a descartar tiene detalle_compras propio"` (mismo criterio que el script de agosto — evita orfandad, aunque hoy verificamos que ninguna de las 54 filas tiene detalle propio).
- Si pasa todos los chequeos → el `rowId` de la fila descartada va a `rowIdABorrar`.

Ejecución: mismo patrón que agosto — dry-run imprime plan + exporta JSON de respaldo fuera del repo; `--apply` requiere `pg_dump` manual previo, corre dentro de una única transacción, cuenta `compras` antes/después y aborta si no coincide, reexporta el JSON final.

### 4.4 Testing (TDD obligatorio, §9.1)

- `computeCompraAnchor`: casos básicos + `importe` nulo → sin ancla utilizable.
- Función de selección de candidatos de reconciliación (la lógica de "no reclamados" de §4.2): 0/1/N candidatos, candidato ya reclamado por su propio hash, candidato reclamado por otra fila del mismo chunk (caso mochila/válvula en su primera carga — no debe reconciliar).
- `planReconciliacionDuplicados`: grupo limpio (1 esDistribuido) → borra la otra; grupo sin distribuidas, empate de longitud → excluido; ambas distribuidas → excluido; forma inesperada (3+ filas) → excluido; candidata a borrar con detalle propio → excluido; sin duplicados → plan vacío.
- Integración del import: fila nueva sin match (created normal), fila que reconcilia (huérfana existe, verificar que el rowId viejo desaparece y el nuevo asume sus campos), fila ambigua (2+ huérfanas, verificar que aparece en `reconciliacionesAmbiguas` y no se fusiona), reimport después de reconciliar (debe actualizar in place, no volver a duplicar — es el test que prueba que el mecanismo realmente corta el problema de raíz). Caso explícito no-fusionable: par mochila/válvula.

## 5. Seguridad y reversibilidad

- La reconciliación hacia adelante (§4.2) nunca borra: solo renombra el `rowId` de una fila existente y actualiza sus campos ERP. Peor caso de falso positivo: dos compras reales distintas que coinciden exacto en los 5 campos del ancla y donde una nunca tuvo comprobante se fusionan en una sola fila. No observado en los datos actuales; se documenta como riesgo conocido aceptado (igual que el resto de la identidad partida ya documentada en `compra-identity.ts` — caso Tic, caso multi-ítem con mismo comprobante).
- La limpieza retroactiva (§4.3) sigue el mismo patrón de seguridad que agosto: `pg_dump` manual obligatorio antes de `--apply`, transacción única con conteos verificados, grupos de forma riesgosa (ambas distribuidas, detalle propio, forma inesperada) excluidos automáticamente en vez de forzados.
- Ninguna de las 54 filas afectadas hoy tiene `detalle_compras` propio; solo 1 de las 4 filas de la categoría OBSERVAC tiene `esDistribuido=true` — el diseño de §4.3 ya la protege explícitamente (prioridad 1 del criterio de sobreviviente).

## 6. Alcance cerrado

No cubre: relajar `FECHA` en el match (§1, sin evidencia); Ventas (esquema de identidad sin este problema); cambios de schema Prisma; ningún dato fuera de la tabla `compras` (no hay huérfanos que resolver en `detalle_compras`, verificado).
