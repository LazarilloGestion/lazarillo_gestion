# Vista "Compras x Proveedor" — agrupar "Sin Proveedor" por el texto crudo del ERP

**Fecha:** 2026-09-19
**Reportado por:** Diego (observación de cliente, superpuesta al fix del cruce de proveedorId del mismo día)
**Prioridad:** Media-Alta — no es un bug de datos, pero degrada la utilidad de la vista justo después de que el backfill de hoy movió ~11.826 compras al balde "Sin Proveedor"
**Specs relacionados:** `2026-09-19-cruce-proveedorid-compras-design.md` (el fix que aumentó el volumen de "Sin Proveedor"), `2026-09-18-vista-por-proveedor-nivel-rubro-design.md` (introdujo `buildPivotDataByProveedor` y el balde único actual)

## 1. Contexto

### 1.1 El pedido del cliente

En la vista "Compras x Proveedor" (agrupada por proveedor), todo lo que no tiene un `proveedorId` real vinculado cae hoy en un único nodo "Sin Proveedor". El cliente pide que, en cambio, se muestre el dato que ya viene en la fila — el texto crudo del ERP (`compras.proveedor`) — porque ese campo puede traer un nombre de empleado ("Diego", "Gabriel") o el placeholder genérico del ERP de origen ("GASTOS VARIOS"), y son formas distintas de cargar una transacción sin proveedor real, no lo mismo.

### 1.2 Por qué hoy no es así (decisión previa, no un bug)

`lib/dashboard/constants.ts` documenta que esto fue deliberado: la SQL de `/api/dashboard/pivot` ya calcula `proveedor_nombre` con `COALESCE(p.nombre, p.razon, c.proveedor, 'Sin Proveedor')`, así que cuando no hay `proveedorId` ese valor YA es el texto crudo (o el literal `'Sin Proveedor'` si tampoco hay texto). Pero `lib/dashboard/pivot-por-proveedor.ts` decidió no confiar en ese valor para agrupar, por miedo a fragmentar el árbol con valores arbitrarios, y fuerza la constante `SIN_PROVEEDOR_NOMBRE` para todo lo que no tenga `proveedorId`.

### 1.3 Alcance verificado (query de solo lectura, 19-sep-2026, post-backfill de hoy)

De las 11.826 compras con `proveedorId = null`:
- **11.793 tienen texto crudo útil**: 134 valores distintos — 8.072 son `"GASTOS VARIOS"`, el resto son nombres de persona con conteos de decenas a cientos cada uno (Facundo 262, Lautaro Ruben 227, Diego 120, Camila 116, etc.).
- **33 no tienen ni proveedorId ni texto** — esas sí deben seguir cayendo en un "Sin Proveedor" genérico real.
- Los 134 valores distintos ya son 134 grupos distintos **incluso sin normalizar** (no hay hoy variantes de mayúsculas/tildes del mismo nombre duplicadas). La normalización (ver §2) es una red de seguridad para importaciones futuras, no algo que cambie el resultado de hoy.

### 1.4 Alcance real de la corrección — 3 piezas, no 1

Investigación encontró que el problema no está solo en el agrupado del árbol:

1. **Árbol de la vista por proveedor** (`lib/dashboard/pivot-por-proveedor.ts`) — el gap reportado.
2. **Composición del tooltip de Apertura** (`lib/dashboard/apertura-composicion.ts`) — tiene el mismo patrón: una compra "sin proveedor real" que pasó por una regla de Apertura a nivel *concepto* o *registro* (no hace falta proveedor para esas reglas) arma la clave de su tooltip con el mismo balde único. Sin corregir esto también, el tooltip de "Diego" mezclaría el reparto de "Gabriel" y "GASTOS VARIOS" bajo el mismo concepto.
3. **Filtro de drill-down** (`app/api/dashboard/detalle/route.ts` + `DetalleFilter`) — hoy clickear la fila "Sin Proveedor" manda `sinProveedor: true` (un booleano) al modal de detalle. Con 134 nodos, hace falta que cada uno filtre solo sus propias compras.

### 1.5 Fuera de alcance (ya investigado, no hace falta tocar)

- **Vista "Compras x Concepto"** (`buildPivotData` en `app/api/dashboard/pivot/route.ts`): ya usa `proveedor_nombre` (con su fallback a texto crudo) directamente por fila (`nombre: proveedor_nombre`, línea ~245), sin agrupar por proveedor en un nivel intermedio — cada compra ya se muestra con su propio texto crudo. No tiene el bug.
- **Apertura de Gastos a nivel proveedor**: el botón "Aperturar" a ese nivel ya está gateado por `proveedor.proveedorId != null` (`components/dashboard/pivot-table-por-proveedor.tsx:245`) — los nuevos nodos por texto crudo siguen sin `proveedorId`, así que quedan afuera de esa acción automáticamente, sin tocar nada de `lib/apertura/`.

## 2. Decisiones (confirmadas con el usuario, 19-sep-2026)

1. **Todos los 134 valores se muestran tal cual** (no se curan ni se agrupan en categorías más amplias) — fiel al dato real del ERP.
2. **Agrupar por texto normalizado**, mismo criterio que ya usa el fix de hoy (`proveedorTextoCoincide`: NFD + sacar signos de puntuación + minúsculas) — para no fragmentar el mismo empleado en dos nodos por un typo de carga futuro. El label que se muestra es el texto crudo tal cual vino en la primera fila vista de ese grupo (no el texto normalizado).
3. **Drill-down por texto exacto** (sin normalizar) — dado que hoy no hay colisiones de variantes (§1.3), esto cubre el 100% de los datos actuales. Límite aceptado: si en el futuro aparece una variante de mayúsculas/tilde del mismo nombre, el árbol la va a agrupar bien pero el drill-down podría no traer esa variante puntual — se prefiere esto a sumar la extensión `unaccent` de Postgres (una migración de schema) por un caso que hoy no existe.

## 3. Arquitectura

### 3.1 Extraer la normalización a un módulo neutral (`lib/text-normalize.ts`, nuevo)

`lib/etl/normalizers/proveedor-match.ts` tiene hoy una función privada `normalizarParaComparar` con exactamente el criterio que hace falta acá. Como es lógica genérica de comparación de texto (no específica del ETL) y el dashboard no debe depender de la capa de import (separación de capas, CLAUDE.md §1), se mueve a un módulo neutral:

```ts
// lib/text-normalize.ts

// Normaliza texto para comparaciones tolerantes a mayúsculas, tildes y
// puntuación — NFD + strip de marcas combinantes antes de descartar lo
// no-alfanumérico (si no, "Agustín" perdería la "í" entera y dejaría de
// coincidir con "Agustin"). Usado por el ETL (lib/etl/normalizers/
// proveedor-match.ts) y por el dashboard (agrupación de "Sin Proveedor" por
// texto crudo, ver spec 2026-09-19-agrupar-sin-proveedor-por-texto-crudo-design.md)
// para el mismo criterio de comparación en ambas capas.
export function normalizarTexto(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}
```

`lib/etl/normalizers/proveedor-match.ts` pasa a importar `normalizarTexto` desde acá en vez de tener su copia privada — mismo comportamiento, una sola fuente.

### 3.2 Árbol por proveedor (`lib/dashboard/pivot-por-proveedor.ts`)

`SqlRow.proveedor_nombre` ya trae el texto crudo (o el literal `'Sin Proveedor'`) cuando `proveedor_id` es null — no hace falta ninguna columna SQL nueva para esta pieza.

Reemplazar:

```ts
const provKeyOriginal = proveedor_id != null ? String(proveedor_id) : SIN_PROVEEDOR_KEY;
...
nombre: proveedor_id != null ? proveedor_nombre : SIN_PROVEEDOR_NOMBRE,
```

por:

```ts
const provKeyOriginal = proveedor_id != null ? String(proveedor_id) : `texto:${normalizarTexto(proveedor_nombre)}`;
...
nombre: proveedor_nombre,
```

`proveedor_nombre` ya resuelve correctamente los 3 casos: proveedor real (vía el JOIN previo a este punto, aunque acá siempre es la rama `proveedor_id != null`), texto crudo tal cual (Diego, Gabriel, GASTOS VARIOS), o el literal `"Sin Proveedor"` para las 33 filas sin ningún dato — que al normalizarse (`sinproveedor`) cae en su propio grupo estable, sin necesitar ya la constante `SIN_PROVEEDOR_KEY` en este archivo. `SIN_PROVEEDOR_NOMBRE`/`SIN_PROVEEDOR_KEY` en `constants.ts` quedan para el caso genérico (ya no se referencian desde acá, pero no se borran — ver "Fuera de alcance" si hay otro consumidor).

`PivotProveedorSubRow` y `PivotConceptoSubRow` (en `lib/dashboard/types.ts`) suman un campo `proveedorTexto: string | null` — el texto crudo del grupo cuando `proveedorId` es null (para que el componente de UI pueda armar el filtro de drill-down sin recalcular nada, ver §3.4). Se completa al construir cada nodo: `proveedorTexto: proveedor_id != null ? null : proveedor_nombre`.

### 3.3 Composición del tooltip (`app/api/dashboard/pivot/route.ts` + `lib/dashboard/apertura-composicion.ts`)

Las dos queries de composición (`composicionDestinosQuery`, `composicionOriginalesQuery`) agregan la misma expresión que ya usa la query principal:

```sql
COALESCE(p.nombre, p.razon, c.proveedor, 'Sin Proveedor') AS proveedor_nombre
```

al `SELECT` y al `GROUP BY` de ambas (ya hacen JOIN a `proveedores p`, no hace falta ningún JOIN nuevo). `ComposicionSqlRow` y `ComposicionOriginalRow` (en `lib/dashboard/apertura-composicion.ts`) suman `proveedor_nombre: string`.

En `buildComposicionPorProveedor`, la función `key`:

```ts
const key = (concepto: string, proveedorId: number | null) =>
  `${concepto}|${proveedorId ?? SIN_PROVEEDOR_KEY}`;
```

pasa a:

```ts
const key = (concepto: string, proveedorId: number | null, proveedorNombre: string) =>
  `${concepto}|${proveedorId != null ? String(proveedorId) : `texto:${normalizarTexto(proveedorNombre)}`}`;
```

(mismo formato de clave `texto:<normalizado>` que usa §3.2, para que `pivot-por-proveedor.ts` — que arma `composicionPorProveedor[`${concepto_codigo}|${provKeyOriginal}`]` — encuentre la entrada correcta sin traducir formatos). `ensure(...)` pasa el `proveedor_nombre` de cada fila a `key(...)`.

### 3.4 Filtro de drill-down (`DetalleFilter`, `params.ts`, `app/api/dashboard/detalle/route.ts`, `pivot-table-por-proveedor.tsx`)

`lib/dashboard/types.ts` — `DetalleFilter` suma un campo, mutuamente excluyente con `proveedorId` y `sinProveedor`:

```ts
export type DetalleFilter = BaseDashboardFilter & {
  rubroCodigo?: string;
  conceptoCodigo?: string;
  proveedorId?: number;
  // Sin proveedorId pero con texto crudo del ERP (Diego, Gabriel, GASTOS
  // VARIOS, etc.) — mutuamente excluyente con proveedorId y sinProveedor.
  proveedorTexto?: string;
  // Sin proveedorId NI texto crudo — las ~33 filas realmente vacías.
  sinProveedor?: boolean;
  rowId?: string;
  distribucionId?: number;
};
```

`lib/dashboard/params.ts` (`buildComprasDetalleUrl`):

```ts
if (filter.proveedorId) params.set("proveedorId", String(filter.proveedorId));
else if (filter.proveedorTexto) params.set("proveedorTexto", filter.proveedorTexto);
else if (filter.sinProveedor) params.set("sinProveedor", "1");
```

`app/api/dashboard/detalle/route.ts`: nuevo parseo (mismo patrón que `conceptoCodigo`, con un esquema Zod de texto acotado — máximo 256 caracteres, igual límite que ya usa `observacionQuery` en el pivot) y nueva condición:

```ts
if (proveedorId !== undefined) conditions.push(Prisma.sql`p.id = ${proveedorId}`);
else if (proveedorTexto !== undefined) conditions.push(Prisma.sql`c."proveedorId" IS NULL AND c.proveedor = ${proveedorTexto}`);
else if (sinProveedor) conditions.push(Prisma.sql`c."proveedorId" IS NULL AND c.proveedor IS NULL`);
```

(el `AND c.proveedor IS NULL` en la rama `sinProveedor` es nuevo — antes ese filtro no hacía falta ser tan específico porque era el único balde; ahora que `proveedorTexto` cubre el resto, `sinProveedor` debe acotarse a las filas realmente vacías para no solaparse).

`components/dashboard/pivot-table-por-proveedor.tsx`: `filtroProveedor` y `filtroProveedorConcepto` pasan de:

```ts
proveedor.proveedorId != null ? { proveedorId: proveedor.proveedorId } : { sinProveedor: true as const }
```

a:

```ts
proveedor.proveedorId != null
  ? { proveedorId: proveedor.proveedorId }
  : proveedor.proveedorTexto != null
    ? { proveedorTexto: proveedor.proveedorTexto }
    : { sinProveedor: true as const }
```

(mismo patrón para `concepto.proveedorTexto`, que sube desde `PivotConceptoSubRow` igual que `proveedorId` ya sube hoy).

## 4. Testing

- `lib/text-normalize.test.ts` (nuevo): casos ya cubiertos en `proveedor-match.test.ts` migran acá o se referencian — un texto con tilde normaliza igual que sin tilde, mayúsculas/puntuación no importan.
- `lib/etl/normalizers/proveedor-match.test.ts`: sigue pasando sin cambios de comportamiento (solo cambia de dónde importa `normalizarTexto`).
- `lib/dashboard/pivot-por-proveedor.test.ts` (si no existe, crear): fila con `proveedor_id` null y `proveedor_nombre` = "Diego" agrupa bajo un nodo `nombre: "Diego"`, no bajo "Sin Proveedor"; dos filas con texto crudo que normaliza igual (case distinto) caen en el mismo nodo; una fila con `proveedor_nombre` = "Sin Proveedor" (el literal, sin texto real) cae en su propio grupo separado de cualquier texto real.
- `lib/dashboard/apertura-composicion.test.ts`: `buildComposicionPorProveedor` con dos filas de distinto texto crudo bajo el mismo concepto produce dos entradas de composición separadas, no una mezclada.
- `app/api/dashboard/detalle/route.ts`: si tiene tests de integración, agregar caso de `proveedorTexto` filtrando correctamente; si no los tiene, no se agregan a mano acá (fuera del patrón existente del archivo).
