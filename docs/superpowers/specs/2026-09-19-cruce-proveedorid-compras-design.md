# Corrección — Cruce de proveedor por colisión de código en el ETL de compras

**Fecha:** 2026-09-19
**Reportado por:** Imanol (bug real detectado en producción — vista Compras x Proveedor, rubro Gastos En Personal, "Creación Tm Sr" en vez de "Diego")
**Prioridad:** Alta — afecta la exactitud de toda vista que agrupe compras por proveedor, en producción, con datos financieros reales
**Memoria relacionada:** `project_alta_nunez_comercio.md` (colisión de códigos entre negocios — problema hermano, distinto mecanismo), `project_fix_duplicados_main_dev.md` (mismo patrón de riesgo/ejecución para correcciones sobre `compras` ya importadas)

## 1. Contexto

### 1.1 La falla observada

En la vista "Compras x Proveedor", bajo "Gastos En Personal", una compra de concepto "B. Liquidacion De Sueldo" se mostraba agrupada bajo el proveedor "Creación Tm Sr". Al abrir el detalle de esa misma compra, la columna Proveedor mostraba "Diego". Mismo `rowId`, dos nombres distintos — el pivot resuelve el nombre por `proveedorId` (join en vivo contra el maestro `proveedores`), el detalle muestra primero el texto crudo importado (`compras.proveedor`).

### 1.2 Causa raíz

En `lib/etl/normalizers/compras.ts`, el `CODIGO` de una fila de compra no siempre es un código de proveedor del maestro — en filas de planilla de sueldos o de gastos genéricos (`"GASTOS VARIOS"`, o solo un nombre de pila), el ERP reutiliza esa columna para un identificador que no tiene relación con el maestro de proveedores. Cuando ese número coincide por azar con el `codigo` de un proveedor real, el import linkea `proveedorId` a un proveedor incorrecto.

Un fix anterior (commit `aa0d594`, 08-ago-2026) detectó este patrón pero lo acotó a un único concepto exacto (`"Liquidacion Sueldo"`, código `301`, rubro "Gastos En Personal") — un whitelist por nombre de concepto. Cualquier fila con el mismo patrón bajo un concepto distinto (incluido el que motivó este reporte, "B. Liquidacion De Sueldo") queda fuera del guard y repite el bug.

### 1.3 Alcance real (verificado con queries de solo lectura contra producción, 19-sep-2026)

El problema **no está limitado al rubro "Gastos En Personal"**. Comparando, para toda la tabla `compras` con `proveedorId` no nulo, el texto crudo (`compras.proveedor`) normalizado (minúsculas, sin signos) contra el `nombre` del proveedor joineado:

- 11.395 filas coinciden (link correcto).
- **2.164 filas no coinciden** (link probablemente cruzado), distribuidas en casi todos los rubros: Mercaderías (977), Otros Gastos (429), Gastos En Personal (294), Mantenimiento (221), Servicios (81), Impuesto Fiscal (32), Publicidad (27), Inversiones (23), Impuesto Varios (22), Deudas (18), Iva Compra (16), Intereses (14), Alquiler (7), y algunos más con 1 fila.

Patrón consistente en las filas cruzadas: el texto crudo es un nombre de pila suelto ("Facundo", "Diego", "Emiliano", "Agustín", "victoria", etc.) o el placeholder genérico `"GASTOS VARIOS"` — nunca una razón social real — mientras que el proveedor joineado es siempre una empresa real no relacionada.

En 109 filas de las 23.338 totales, `compras.proveedor` es `null` y `proveedorId` no lo es — sin texto no hay con qué contradecir el link por código.

### 1.4 `detalle_compras` — mismo patrón de riesgo, sin bug visible

`lib/etl/normalizers/detalle-compras.ts` resuelve `proveedorId` desde `COD_PRO` contra el mismo maestro, sin ninguna validación. A diferencia de `compras`, esa tabla **no tiene ningún campo de texto libre de proveedor** (`nombre` ahí es el nombre del artículo, no del proveedor) — no hay con qué validar por contenido. Confirmado por búsqueda en el código: ningún endpoint ni componente lee `detalleCompra.proveedorId` hoy (`app/api/dashboard/compra-lineas/[compraId]/route.ts` no lo selecciona). Es dato muerto, pero con el mismo riesgo latente si el día de mañana se empieza a usar.

## 2. Decisiones (confirmadas con el usuario, 19-sep-2026)

1. **Backfill incluido**: además de cortar la causa en el ETL para futuros imports, este trabajo corrige las filas ya mal linkeadas en producción (2.164 + 294 ya contadas dentro de ese total, no se suman dos veces — ver §1.3).
2. **`detalle-compras.ts` incluido**: se corrige en el mismo plan, dejando de resolver `proveedorId` de forma independiente (ver §3.3) en vez de replicar una validación de contenido que no tiene datos para sostenerse.

## 3. Arquitectura

### 3.1 Regla de validación de contenido (nueva)

Nueva función helper, ubicación propuesta `lib/etl/normalizers/proveedor-match.ts`:

```ts
// Compara el texto crudo de proveedor de una fila del ERP contra el nombre/razón
// de un proveedor candidato del maestro, normalizando ambos (minúsculas, sin
// signos de puntuación) antes de comparar. Usado para no confiar ciegamente en
// un CODIGO que coincide por azar con el código de un proveedor real cuando el
// CODIGO en realidad identifica otra cosa (empleado, "GASTOS VARIOS", etc.) —
// ver spec 2026-09-19-cruce-proveedorid-compras-design.md.
//
// Asimetría intencional: si no hay texto para comparar (null), se confía en el
// código (no hay evidencia en contra). Si hay texto y no matchea ninguno de
// nombre/razón, se descarta el link — preferible mostrar "Sin Proveedor" a
// mostrar una empresa incorrecta.
export function proveedorTextoCoincide(
  textoCrudo: string | null,
  candidato: { nombre: string | null; razon: string | null },
): boolean {
  if (textoCrudo == null) return true;
  // NFD + strip de marcas combinantes antes de descartar lo no-alfanumérico:
  // sin eso "Agustín" perdería la "í" entera y dejaría de coincidir con
  // "Agustin" del maestro (desviación deliberada, revisión final 19-sep-2026).
  const norm = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
  const t = norm(textoCrudo);
  return (candidato.nombre != null && norm(candidato.nombre) === t)
      || (candidato.razon  != null && norm(candidato.razon)  === t);
}
```

Verificado contra el dataset completo (§1.3): separa limpio los 11.395 casos correctos de los 2.164 cruzados. Único falso-negativo encontrado en la muestra completa: un proveedor con un carácter corrupto en el maestro ("Diseños" → "Diseoos", 1 fila) — cae a `null` en vez de mantenerse. Se acepta ese costo: el fix prioriza no mostrar una empresa incorrecta por sobre preservar un link válido con basura de encoding.

### 3.2 `lib/etl/normalizers/compras.ts`

- Se elimina `codigosGastoPersonal` y su filtro por nombre de concepto (líneas ~164-173 y el `&& !codigosGastoPersonal.has(...)` en la resolución de `proveedorId`, línea ~199-200).
- El `findMany` de `prisma.proveedor` (línea ~150-155) trae también `nombre` y `razon`, no solo `id`/`codigo` — `provMap` pasa a mapear `codigo -> { id, nombre, razon }`.
- Al resolver `proveedorId` por fila: si `provMap.get(data.CODIGO)` existe, se aplica `proveedorTextoCoincide(data.PROVEEDOR, candidato)`; si no coincide, `proveedorId = null`.
- Aplica a **todas** las filas, sin distinción de rubro/concepto — reemplaza el whitelist puntual por una validación transversal.

### 3.3 `lib/etl/normalizers/detalle-compras.ts`

No se puede aplicar §3.1 (sin campo de texto de proveedor en esta tabla). Se deja de resolver `proveedorId` de forma independiente por `COD_PRO` — la fila se inserta con `proveedorId = null` siempre. Si en el futuro se necesita mostrar proveedor a nivel línea, debe derivarse del `compra` ya vinculado por `compraId`/comprobante (que si pasa por la validación de §3.1), nunca de un lookup propio sin datos para verificarse.

### 3.4 Backfill (`scripts/fix-proveedorid-cruzado.ts`, nuevo)

Mismo patrón que `scripts/cleanup-duplicados-compras.ts` (agosto 2026):

1. **Dry-run por defecto**: recorre `compras` con `proveedorId IS NOT NULL`, aplica `proveedorTextoCoincide` contra el proveedor actualmente linkeado, reporta cuántas filas pondría en `null`, agrupadas por rubro (mismo desglose que §1.3) — sin escribir nada.
2. **Backup**: `pg_dump -Fc` contra `DIRECT_URL` antes de `--apply`, igual que el incidente de duplicados.
3. **`--apply`**: transacción única, `UPDATE compras SET "proveedorId" = NULL WHERE ...`, cuenta antes/después dentro de la misma transacción.
4. Ejecución real contra producción la lleva el agente en la conversación principal, con el usuario presente, con confirmación explícita antes del `--apply` (CLAUDE.md §7 — dato financiero sensible). No se delega a un subagente.
5. `detalle_compras.proveedorId` no necesita backfill — pasa a ser siempre `null` desde el fix de ETL (§3.3), pero las filas ya importadas pueden quedar con un valor viejo; como nadie lo lee (§1.4), no es necesario limpiarlo en este trabajo. Se deja anotado como deuda menor, no bloqueante.

### 3.5 Fuera de alcance

- Cambios de schema de Prisma / migraciones — todo el fix es lógica de ETL + un backfill de `UPDATE`, no cambia columnas.
- La vista de pivot (`app/api/dashboard/pivot/route.ts`, `lib/dashboard/pivot-por-proveedor.ts`) y el modal de detalle — no cambian; ya leen `proveedorId`/texto crudo correctamente, el problema estaba aguas arriba en el import.
- Limpieza del `proveedorId` viejo en `detalle_compras` (ver §3.4.5).
- Cualquier mejora al matching además de igualdad exacta normalizada (fuzzy matching, distancia de edición) — la asimetría de costo (§3.1) hace que no valga la complejidad adicional (YAGNI).

## 4. Testing

TDD obligatorio para esta capa (CLAUDE.md §4, skill `test-driven-development`).

- `lib/etl/normalizers/proveedor-match.test.ts` (nuevo): texto coincide exacto → `true`; coincide solo con `razon` → `true`; no coincide → `false`; texto `null` → `true`; variantes de mayúsculas/puntuación → `true`; caso real de regresión (`"Diego"` vs `{ nombre: "Creacion Tm Sr" }`) → `false`.
- `lib/etl/normalizers/compras.test.ts`: agregar caso donde `CODIGO` coincide con un proveedor real pero `PROVEEDOR` no matchea → `proveedorId` queda `null` en la fila insertada; caso donde sí matchea → se mantiene. Remover/actualizar el test existente que cubre el guard viejo de `codigosGastoPersonal` (si lo hay) para que pase por la regla nueva.
- `lib/etl/normalizers/detalle-compras.test.ts`: `proveedorId` siempre `null` en la fila insertada, sin importar `COD_PRO`.
- `scripts/fix-proveedorid-cruzado.test.ts` (o suite equivalente al de `cleanup-duplicados-compras`): dry-run reporta el conteo esperado sobre un fixture con casos mezclados; `--apply` solo actualiza las filas que no coinciden; no toca las que sí coinciden ni las de texto `null`.
