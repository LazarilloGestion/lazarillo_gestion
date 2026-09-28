# Código de empleado en la vista Compras x Proveedor — y fix de agrupado por nombre

**Fecha:** 2026-09-28
**Reportado por:** cliente de Diego (vía WhatsApp), sobre la vista "Compras x Proveedor" del dashboard
**Prioridad:** Alta — deja de ser solo un pedido de UI: la investigación encontró que compras de personas distintas se están sumando bajo una misma fila, y que 8 reglas de Apertura de Gastos activas reparten plata real mezclando esas personas.
**Specs relacionados:** `2026-09-19-agrupar-sin-proveedor-por-texto-crudo-design.md` (decisión previa de agrupar por texto, sin código — este spec la revierte parcialmente), `2026-09-19-cruce-proveedorid-compras-design.md`, `2026-09-20-apertura-proveedor-texto-crudo-design.md`

## 1. Contexto

### 1.1 El pedido original

Bajo el rubro "Gastos En Personal" (código `3`), varias filas de "proveedor" son en realidad personas de planilla cargadas como proveedor en el ERP del cliente (ver `lib/etl/normalizers/proveedor-match.ts`). Los nombres se repiten o son ambiguos ("Alejo" vs "Alejo Rodrigo", "Abril", "Agustin"), y el cliente pidió anteponer el código de empleado al nombre para poder identificar a quién corresponde cada fila (ej. "608 - Santiago Benjamin").

### 1.2 De dónde sale el código — investigación

El cliente mencionó "tabla 14" como la fuente del código. Se confirmó contra Drive: **"14 - gastos compras detallado ..."** es el mismo archivo que ya se importa como tipo `compras` (headers `COD_CGA,CONCEPTO,FECHA,CODIGO,PROVEEDOR,...`, ver `lib/etl/detect-file-type.ts`). La columna D (`CODIGO`) ya se guarda tal cual en `Compra.codigo` en cada importación — **no hace falta ningún import nuevo**.

Intento inicial (descartado): usar `Proveedor.codigo` vía el JOIN existente (`p.id = c."proveedorId"`). No funciona para los casos que más lo necesitan — las personas de planilla casi siempre están en `compras.proveedor` (texto crudo del ERP) SIN `proveedorId` vinculado, así que `Proveedor.codigo` es `null` para ellas. El código correcto es el que ya viene en cada compra: `Compra.codigo`.

### 1.3 Hallazgo mayor: el agrupado por nombre mezcla personas distintas

Investigando por qué el código no aparecía, se encontró (query de solo lectura contra producción, 28-sep-2026) que **el mismo nombre normalizado puede corresponder a personas distintas con códigos distintos**. Ejemplos reales bajo compras sin `proveedorId` (`proveedorId IS NULL`), agrupadas hoy por `texto:${normalizarTexto(proveedor)}` en `lib/dashboard/pivot-por-proveedor.ts`:

- "Abril" → código 368 (53 compras) y código 670 (16 compras)
- "Agustin" → códigos 345, 389, 559, 462
- "Camila" → 5 códigos distintos (363, 388, 424, 597, 660)
- "GASTOS VARIOS" (balde genérico, no es una persona) → 29 códigos distintos

Esto no es solo un problema de presentación: **la vista ya suma la plata de personas distintas bajo una sola fila**, y el drill-down/tooltip de esa fila mezcla sus compras.

### 1.4 Hallazgo más grave: reglas de Apertura de Gastos activas sobre nombres ambiguos

`lib/dashboard/pivot-por-proveedor.ts` construye `entidadIdProveedor` con el mismo valor que usa la clave de agrupación (`texto:${normalizarTexto(nombre)}`) — es el mismo valor que usan `condicionMatchNivel` (`lib/apertura/motor.ts`) y `resolverEntidadIdProveedor` (`lib/apertura/reevaluacion.ts`) para matchear compras contra reglas de Apertura a nivel "proveedor". Esto es deliberado (una sola fuente de verdad, ver comentarios en el código), pero significa que **el bug de agrupado también existe en las reglas de reparto de plata real**.

Query de solo lectura contra `reglas_apertura` (nivel `proveedor`, `estado = 'activa'`): **35 reglas activas**, **32 usan `entidadId` con formato `texto:...`**. Cruzando cada una contra los códigos reales de su nombre:

- **24 reglas son seguras** — su nombre corresponde a un único código en las compras. Ejemplos: `texto:diego`, `texto:santiagobenjamin` (×2, vigencias distintas), `texto:alejorodrigo` (×2), `texto:lautaroruben` (×2), `texto:vanesajudit` (×3), `texto:avril` (×4), `texto:uriel` (×2), `texto:ricardojuan` (×2), y 8 más de un solo nombre/código.
- **8 reglas son ambiguas** — su nombre corresponde a 2 a 5 personas distintas, y la regla les aplica el mismo reparto a todas sin distinguirlas:

  | Regla(s) | Nombre | Códigos mezclados |
  |---|---|---|
  | 175 | Camila | 363, 388, 424, 597, 660 |
  | 200 | Franco | 439, 532, 685 |
  | 190 | Gabriel | 369, 673 |
  | 204 | Jorge | 355, 506, 507 |
  | 186, 187, 188 | Lucas (3 reglas, mismos códigos) | 543, 638, 671 |
  | 199 | Micaela | 436, 560 |

**Decisión del usuario (confirmada 28-sep-2026): esto fue un error** — cada persona real debería tener su propio reparto, no uno compartido por nombre. Las 8 reglas ambiguas se **borran** (no se desactivan) y se **redistribuye el historial** que ya repartieron — no solo las compras futuras.

## 2. Decisiones confirmadas

1. **Formato "608 - Nombre"** para el prefijo (espacio, guion, espacio).
2. **Alcance del prefijo visual**: solo la fila de proveedor en `pivot-table-por-proveedor.tsx` (no tooltip de composición, no el nombre que usa Apertura al crear una regla).
3. **El prefijo se muestra solo en rubro "Gastos En Personal" (`rubroCodigo === "3"`)** — en el resto de rubros el nombre alcanza y no se antepone nada.
4. **Fuente del código**: `Compra.codigo` (raw, por fila de compra), no `Proveedor.codigo`.
5. **Clave de agrupado**: se corrige para TODOS los rubros (no solo el 3) y para todo proveedor sin `proveedorId` real — pasa de `texto:${normalizado}` a `texto:${normalizado}|codigo:${codigo}`. Aplica parejo a "GASTOS VARIOS" también (se fragmenta en más filas, una por código real — es la corrección correcta, no una excepción).
6. **Reglas de Apertura**:
   - Las 24 reglas seguras se migran (mismo reparto, `entidadId` nuevo con el código correspondiente).
   - Las 8 reglas ambiguas se **borran**.
   - El historial que esas 8 reglas ya distribuyeron se **revierte y se vuelve a repartir** contra las nuevas reglas (una por persona real, mismo reparto que tenía la regla original — es la única información de intención que existe).
7. Compras sin `codigo` (si las hubiera) o sin texto (el balde genuino "Sin Proveedor", `texto:sinproveedor`) **no llevan sufijo `|codigo:`** — quedan agrupadas como hoy, sin fragmentar un balde que no es una identidad.

## 3. Arquitectura

### 3.1 Migración de schema: exponer `codigo` en `v_compras_distribuidas`

La vista actual (`prisma/migrations/20260916131712_v_compras_distribuidas_origen/migration.sql`) no expone `compras.codigo`. Nueva migración Prisma: `DROP VIEW` + `CREATE VIEW` (mismo patrón que la migración de referencia) agregando `c.codigo` a las dos ramas del `UNION ALL` (distribuido / no distribuido).

### 3.2 Query del pivot (`app/api/dashboard/pivot/route.ts`)

En el `rowsQuery` principal (el que alimenta `buildPivotDataByProveedor`), sumar al SELECT:
```sql
c.codigo AS proveedor_codigo
```
(no hace falta en las queries de composición del tooltip — alcance ya acotado en §2.2).

### 3.3 Tipos (`lib/dashboard/types.ts`)

- `SqlRow.proveedor_codigo: string | null`.
- `PivotProveedorSubRow` suma `codigo: string | null` y `rubroCodigo: string` (mismo patrón que ya usa `PivotConceptoSubRow.rubroCodigo`).

### 3.4 Builder (`lib/dashboard/pivot-por-proveedor.ts`)

Clave de agrupación:
```ts
const provKeyOriginal = proveedor_id != null
  ? String(proveedor_id)
  : proveedor_codigo != null
    ? `texto:${normalizarTexto(proveedor_nombre)}|codigo:${proveedor_codigo}`
    : `texto:${normalizarTexto(proveedor_nombre)}`;
```
Al construir el nodo `PivotProveedorSubRow`: `codigo: proveedor_codigo`, `rubroCodigo: rubro_codigo`.

### 3.5 UI (`components/dashboard/pivot-table-por-proveedor.tsx`)

Reemplazar `{normalize(proveedor.nombre)}` por: si `proveedor.rubroCodigo === RUBRO_GASTOS_EN_PERSONAL_CODIGO` (nueva constante `"3"` en `lib/dashboard/constants.ts`) y `proveedor.codigo` no es null, `"${codigo} - ${normalize(nombre)}"`; si no, el nombre solo.

### 3.6 Motor de Apertura — mismo criterio de matching (`lib/apertura/motor.ts`, `lib/apertura/reevaluacion.ts`)

`condicionMatchNivel` (nivel "proveedor", rama `texto:`) y `resolverEntidadIdProveedor` deben parsear el nuevo formato `texto:<normalizado>|codigo:<codigo>` sin tocar la columna ya materializada `Compra.proveedorTextoNormalizado` (evita re-normalizar histórico):

```ts
// resolverEntidadIdProveedor (reevaluacion.ts)
export function resolverEntidadIdProveedor(compra: { proveedorId: number | null; proveedor: string | null; codigo: string | null }): string {
  if (compra.proveedorId != null) return String(compra.proveedorId);
  const base = `texto:${normalizarProveedorTexto(compra.proveedor)}`;
  return compra.codigo != null ? `${base}|codigo:${compra.codigo}` : base;
}
```
(agrega `codigo` al `select` de `reevaluarCompra` en el mismo archivo.)

```ts
// condicionMatchNivel (motor.ts), rama "texto:"
if (entidadId.startsWith("texto:")) {
  const resto = entidadId.slice("texto:".length);
  const [valorNormalizado, codigoParte] = resto.split("|codigo:");
  return codigoParte !== undefined
    ? Prisma.sql`(c."proveedorId" IS NULL AND c."proveedorTextoNormalizado" = ${valorNormalizado} AND c."codigo" = ${codigoParte})`
    : Prisma.sql`(c."proveedorId" IS NULL AND c."proveedorTextoNormalizado" = ${valorNormalizado})`;
}
```
Cualquier otro sitio que arme o parsee este formato (`app/api/dashboard/pivot/route.ts` composición, `lib/dashboard/apertura-composicion.ts`) se revisa en el plan de implementación — deben seguir el mismo criterio para no divergir (mismo riesgo que ya documentó el spec del 19-sep).

## 4. Migración de datos (reglas + historial) — requiere script con dry-run

Sigue el mismo patrón que `scripts/fix-proveedorid-cruzado.ts` (dry-run → backup → confirmación → apply → verificación post), dado que borra reglas y revierte/re-aplica distribuciones sobre compras reales.

### 4.1 Migrar las 24 reglas seguras
Para cada una: nuevo `entidadId` = `texto:<normalizado>|codigo:<código único de ese nombre>`. Update in-place (mismo `id`, no se recrean) — conserva vigencia, destinos, historial de `DistribucionApertura` (que ya apunta a `reglaId`, no a `entidadId`, así que no se toca).

### 4.2 Borrar y redistribuir las 8 reglas ambiguas
Por cada regla ambigua (Camila, Franco, Gabriel, Jorge, Lucas ×3, Micaela):
1. Capturar sus destinos (local/PDV/porcentaje) y vigencia — es el único dato de intención disponible.
2. Por cada código real distinto bajo ese nombre, crear una **regla nueva** (`entidadId` con el código correspondiente) con los MISMOS destinos/porcentaje/vigencia que la regla original de la que salió.
3. Revertir las compras que la regla vieja ya distribuyó (`revertirCompra` de `lib/apertura/motor.ts`, o el `DELETE` equivalente + reset de `esDistribuido`/`distribuidoEn` en `Compra`) — identificadas por `DistribucionApertura.reglaId IN (8 ids)`.
4. Borrar las 8 reglas viejas (`DestinoRegla` y `DistribucionApertura` ya revertidos/huérfanos se limpian en cascada o explícitamente).
5. Reevaluar cada compra revertida (`reevaluarCompra`) — ahora matchea la regla nueva específica de su código.
6. Verificación: suma total de plata distribuida por nombre ANTES == suma total DESPUÉS (se redistribuye distinto por persona, pero no debe cambiar el total).

### 4.3 Orden de ejecución
El backfill de reglas (§4.1, §4.2) debe correr **después** de que el código de aplicación (§3) esté deployado — antes de eso, `condicionMatchNivel`/`resolverEntidadIdProveedor` todavía esperan el formato viejo y una regla ya migrada no matchearía nada.

## 5. Testing

- `lib/dashboard/pivot-por-proveedor.test.ts`: nodo con `proveedor_codigo` no null arma `id`/`entidadIdProveedor` con el sufijo `|codigo:`; dos filas mismo nombre distinto código → dos nodos separados, no se mezclan; sin `proveedor_codigo` (null) → sin sufijo, mismo comportamiento que hoy.
- `lib/apertura/reevaluacion.test.ts`: `resolverEntidadIdProveedor` con `codigo` no null agrega el sufijo; con `codigo` null no lo agrega (compatibilidad con reglas ya migradas a formato sin código, si las hubiera).
- `lib/apertura/motor.test.ts`: `condicionMatchNivel` nivel proveedor parsea correctamente `texto:x|codigo:y` (dos condiciones AND) y `texto:x` sin código (una condición, comportamiento actual).
- Script de migración de reglas: tests unitarios sobre la lógica de "qué reglas son seguras vs ambiguas" y "qué destinos replicar", corridos contra fixtures — no contra producción (igual patrón que `fix-proveedorid-cruzado.test.ts`).

## 6. Riesgos y fuera de alcance

- **Riesgo principal**: el script de §4.2 revierte y re-aplica distribución sobre compras reales de 6 nombres (Camila, Franco, Gabriel, Jorge, Lucas, Micaela) — dry-run obligatorio, backup antes de aplicar, confirmación explícita del usuario antes de cada `apply` (igual que Task 5 de `fix-proveedorid-cruzado`, que quedó pendiente de correr en su momento — no repetir ese patrón acá, este backfill si o si se corre con evidencia).
- **Fuera de alcance**: cualquier nombre/código NO cubierto por las 35 reglas activas actuales no se toca — si en el futuro aparece otro nombre ambiguo sin regla, el agrupado nuevo (§3.4) ya lo separa correctamente sin necesitar backfill.
- **Fuera de alcance**: `apertura-composicion.ts` (tooltip) usa su propia clave de composición (`concepto|provKeyOriginal`) — hereda el nuevo formato automáticamente porque consume el mismo `provKeyOriginal`, pero no se le suma lógica nueva más allá de eso.
