# Apertura de Gastos por proveedor de texto crudo — Diseño

**Fecha:** 2026-09-20
**Relacionado:** `docs/superpowers/specs/2026-09-19-agrupar-sin-proveedor-por-texto-crudo-design.md`

## 1. Problema

Tras la feature de agrupación por texto crudo (commits `b909d8b..21568d8`), la vista
"Compras x Proveedor" agrupa las compras sin `proveedorId` real por el texto que trae
el ERP en `compras.proveedor` (ej. "Diego", "Facundo", "GASTOS VARIOS"), y por el
nodo genuino "Sin Proveedor" cuando no hay ni `proveedorId` ni texto (~33 filas).

El cliente reporta que no puede crear una Regla de Apertura de Gastos a nivel
"proveedor" para ninguno de estos nodos — solo puede hacerlo para proveedores con
`proveedorId` real.

## 2. Causa raíz (investigada con systematic-debugging)

- El botón de apertura a nivel proveedor está condicionado a
  `proveedor.proveedorId != null` (`components/dashboard/pivot-table-por-proveedor.tsx:247`,
  `components/dashboard/apertura-split-button.tsx:24` — si `puedeAperturar` es `false`
  el botón no se monta, sin mensaje).
- Aunque se sacara ese gate, el motor de reglas (`lib/apertura/motor.ts:27`,
  `condicionMatchNivel`) matchea el nivel "proveedor" únicamente contra
  `c."proveedorId"::text = entidadId` — nunca contra `c.proveedor` (el texto crudo).
  Una regla creada con `entidadId = "Diego"` se guardaría sin error pero nunca
  distribuiría ninguna compra: una regla huérfana silenciosa.
- El modelo (`ReglaApertura.entidadId`, `prisma/schema.prisma:313-317`) es un
  `String` libre sin FK — no impide guardar texto, el problema es solo el motor.
- `lib/apertura/reevaluacion.ts:82-86` (`reevaluarCompra`, dispara al editar
  `importeManual`/`fechaManual`/`conceptoCodigoManual` de una compra) tiene su
  **propia** resolución de `entidadId` de nivel proveedor en TypeScript
  (`compra.proveedorId != null ? String(...) : null`), separada del motor. Si no se
  actualiza en paralelo, queda desactualizada para el caso de texto crudo.
- Confirmado: el único escritor de `compras.proveedor`/`proveedorId` en todo el
  repo es el ETL de importación (más scripts de mantenimiento puntuales) — no hay
  edición manual de proveedor en el dashboard.

## 3. Alcance confirmado con el usuario

- El nodo genuino "Sin Proveedor" (las ~33 filas sin `proveedorId` ni texto) también
  debe poder aperturarse, con el mismo mecanismo que los nodos de texto crudo — sin
  caso especial.
- El criterio de igualdad para matchear es **texto normalizado** (misma función que
  ya agrupa el árbol), no comparación exacta.
- Se descartó la alternativa de materializar cada texto crudo como un `Proveedor`
  real (backfillear `proveedorId` hacia registros sintéticos): el cliente identificó
  explícitamente estos casos como "NO PROVEEDOR" (empleados, no proveedores), y esa
  alternativa reabriría la ambigüedad de integridad de `proveedorId` que la feature
  `cruce-proveedorid-compras` (19-sep-2026) resolvió. Se mantiene el texto crudo como
  una dimensión de matching separada de `proveedorId`.

## 4. Diseño

### 4.1 Columna persistida `compras.proveedorTextoNormalizado`

Migración de Prisma: nueva columna `proveedorTextoNormalizado String?` en `compras`.

- Se calcula **solo** cuando `proveedorId IS NULL`, como
  `normalizarTexto(COALESCE(proveedor, 'Sin Proveedor'))` — la misma función de
  `lib/text-normalize.ts`, nunca reimplementada en SQL (evita duplicar la lógica de
  normalización en dos lenguajes, y evita depender de la extensión `unaccent` de
  Postgres).
- Cuando `proveedorId IS NOT NULL`, queda `NULL` — no se usa para matchear en ese
  caso, y así no hay un valor derivado que alguien deba mantener sincronizado sin
  necesidad.
- Verificado contra datos reales: 173 valores crudos distintos, el más largo
  normalizado con el prefijo `texto:` (ver 4.3) ocupa 33 caracteres — bien dentro del
  límite de 50 del schema zod existente (`lib/apertura/schemas.ts`), sin cambios ahí.

**Escritores:**
- `lib/etl/normalizers/compras.ts` la calcula en cada import nuevo.
- Un script de backfill (mismo patrón revisado y ya usado en
  `scripts/fix-proveedorid-cruzado.ts`: dry-run → backup → apply con
  `--esperadas=<N>`) la completa una sola vez para las ~11.826 filas ya importadas
  con `proveedorId IS NULL`. Ejecución contra producción requiere confirmación
  explícita del usuario en cada paso de riesgo, igual que la feature anterior.

### 4.2 Motor de matching (`lib/apertura/motor.ts`)

`condicionMatchNivel`, rama `"proveedor"` (línea 27):

```ts
if (nivel === "proveedor") {
  if (entidadId.startsWith("texto:")) {
    const valorNormalizado = entidadId.slice("texto:".length);
    return Prisma.sql`c."proveedorId" IS NULL AND c."proveedorTextoNormalizado" = ${valorNormalizado}`;
  }
  return Prisma.sql`c."proveedorId"::text = ${entidadId}`;
}
```

Sin cambios de firma — `aplicarRegla`, `liberarComprasReclamables`,
`condicionComprasElegibles` y el endpoint de preview siguen funcionando igual,
porque todos pasan por esta única función.

### 4.3 Contrato de `entidadId`

Se reutiliza **exactamente** la clave que ya arma el árbol del pivot
(`provKeyOriginal` en `lib/dashboard/pivot-por-proveedor.ts:57-59`:
`` `texto:${normalizarTexto(proveedor_nombre)}` ``), incluido el nodo "Sin
Proveedor" — que ya normaliza a `texto:sinproveedor`, así que queda cubierto sin
lógica adicional (responde el punto de alcance de la sección 3).

Para no recomputar `normalizarTexto` en la UI (y garantizar que la clave usada para
crear la regla sea *byte-idéntica* a la que usa el árbol para agrupar y a la que usa
`apertura-composicion.ts` para el tooltip), se expone un campo nuevo:

- `PivotProveedorSubRow.entidadIdProveedor: string` — igual a `provKeyOriginal`,
  calculado una sola vez donde ya se arma esa constante en `pivot-por-proveedor.ts`.

### 4.4 `lib/apertura/reevaluacion.ts`

`reevaluarCompra` (líneas 82-86) debe resolver el `entidadId` de nivel proveedor con
el mismo criterio que el motor, no comparar `proveedorId` a secas:

```ts
{
  nivel: "proveedor",
  entidadId: compra.proveedorId != null
    ? String(compra.proveedorId)
    : `texto:${normalizarTexto(compra.proveedor ?? "Sin Proveedor")}`,
}
```

Sin este cambio, cualquier compra de "Diego" con una regla de texto activa dejaría
de reevaluarse correctamente al editar su importe/fecha/concepto manual.

### 4.5 UI (`components/dashboard/pivot-table-por-proveedor.tsx`)

- `puedeAperturar` (línea 247) pierde la condición `proveedor.proveedorId != null`
  — queda igual que el nivel "concepto" (línea 314), que nunca tuvo ese gate:
  `puedeAperturar={localId != null && pdvId != null}`.
- El `onClick` que arma el estado de apertura usa
  `entidadId: proveedor.entidadIdProveedor` (no `String(proveedor.proveedorId)`).
- `reglasActivasPorNivel.proveedor.has(...)` (línea 248) también pasa a usar
  `proveedor.entidadIdProveedor`.
- `entidadNombre` sigue usando `proveedor.nombre` sin cambios — ya trae el valor de
  display correcto para todos los casos (texto crudo o "Sin Proveedor").

### 4.6 Fuera de alcance

- El nivel "concepto" (línea 314) no tiene este gate y no se toca.
- `lib/apertura/reimportacion.ts` (`sincronizarTrasImport`) no tiene lógica propia
  de proveedor — delega todo el matching a `condicionMatchNivel` vía
  `reaplicarReglasActivas` → `aplicarRegla`, así que queda correcto automáticamente
  con el cambio de 4.2, sin tocar el archivo.
- `verificarSinSuperposicion` no cambia — ya trata `entidadId` como string opaco.

## 5. Testing

- `lib/apertura/motor.test.ts`: casos nuevos para `condicionMatchNivel`/
  `condicionComprasElegibles` con `entidadId` tipo `"texto:diego"` — matchea compras
  con `proveedorId IS NULL` y `proveedorTextoNormalizado` igual, no matchea compras
  con `proveedorId` real ni con texto normalizado distinto.
- `lib/apertura/reevaluacion.test.ts`: caso de una compra con `proveedorId IS NULL`
  que matchea una regla de texto tras editar `conceptoCodigoManual`.
- `lib/etl/normalizers/compras.test.ts`: el ETL calcula
  `proveedorTextoNormalizado` correctamente cuando `proveedorId` es null, y lo deja
  `null` cuando no lo es.
- `lib/dashboard/pivot-por-proveedor.test.ts`: `entidadIdProveedor` en
  `PivotProveedorSubRow` es igual a `provKeyOriginal` para ambos casos (con y sin
  `proveedorId`).
- Backfill script: tests unitarios sobre la función pura de planificación, mismo
  patrón que `scripts/fix-proveedorid-cruzado.test.ts`.

## 6. Migración y backfill de producción

1. `prisma migrate dev` para la nueva columna (nullable, sin default destructivo).
2. Deploy del ETL actualizado (nuevas importaciones ya completan la columna).
3. Script de backfill dry-run → revisión → apply con confirmación explícita del
   usuario, sobre las ~11.826 filas existentes con `proveedorId IS NULL`.
