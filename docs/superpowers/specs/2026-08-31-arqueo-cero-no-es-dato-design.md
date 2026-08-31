# Fix — "Disponible en caja" en $0 no es un arqueo válido

**Fecha:** 2026-08-31
**Reportado por:** Diego Sebastián Albo (screenshot Dashboard de Resultados, San Justo 2025)
**Prioridad:** Alta — dato financiero visible al cliente, "Diferencia de caja" arranca meses antes de lo correcto
**Memorias relacionadas:** `project_fix_diferencia_caja_spec.md` (este fix **revierte** una decisión de esa sesión), `project_fix_navegacion_anios.md`

## 1. Contexto

En el Dashboard de Resultados de San Justo 2025:

- Los meses **junio, julio y agosto** muestran `$ 0,00` en la fila "Disponible en caja" —
  el usuario nunca cargó un valor para esos meses.
- La fila "Diferencia de caja" arranca en **julio** (primer mes después de junio), mostrando
  valores para julio/agosto que no deberían existir.
- El primer mes con un arqueo real cargado por el usuario es **septiembre**. "Diferencia de
  caja" debería empezar a calcularse recién en **octubre** (mes siguiente al primer arqueo real).

### Causa raíz

Dos problemas encadenados:

1. **El modelo de datos no distingue "arqueo de $0" de "sin arqueo".** `FlujoCajaManual.monto`
   es `Decimal` no-nullable; la única forma de representar "sin dato" es la ausencia de fila.
   Pero existen filas con `monto = 0` para jun/jul/ago que anclan el cálculo igual que un valor
   real.

2. **El camino de escritura genera filas $0 fantasma.** En `caja-rows.tsx`,
   `parseMontoARS("")` devuelve `0` (no `null`), y el guard `if (monto === null) return` no lo
   frena. Abrir el lápiz de edición de un mes y guardar con el campo vacío persiste un `monto = 0`.
   No hay endpoint DELETE, así que una vez creada, la celda no se puede volver a dejar en "—".

`GET /api/dashboard/flujo-caja/primer-arqueo` hace `findFirst` de la primera fila que matchea
el filtro, ordenada por `(anio, mes)` — sin mirar `monto`. Por eso ancla en junio.

### Relación con el fix del 24-ago-2026

El spec `2026-08-24-fix-diferencia-caja-design.md` (sección 3.1) decidió explícitamente **no**
filtrar por `monto`, con el argumento de que "una fila solo existe si el usuario cargó un valor"
y que "un $0 real cargado por el usuario SÍ cuenta como arqueo válido". La observación de Diego
del 31-ago contradice esa premisa: en la práctica hay filas $0 que el usuario no cargó
intencionalmente, y un arqueo de exactamente $0 **no** es un dato de negocio relevante para él.

**Decisión nueva (confirmada por el usuario, 31-ago-2026):** un arqueo de exactamente `$0`
nunca es dato válido. Solo un `monto ≠ 0` cuenta como arqueo.

## 2. Alcance

Dentro de alcance:

- `GET /api/dashboard/flujo-caja/primer-arqueo` — filtrar `monto ≠ 0` al ubicar el primer arqueo.
- `GET /api/dashboard/flujo-caja` — filtrar `monto ≠ 0` al traer los meses (así el endpoint
  devuelve `null` para esos meses y la celda "Disponible en caja" muestra "—").
- `PUT /api/dashboard/flujo-caja` — cuando `monto === 0`, **borrar** la fila en vez de guardarla.
- `computeDiferenciaCajaAcumulada` (`lib/dashboard/resultados-calc.ts`) — tratar `disponible === 0`
  igual que `null` (defensa en profundidad).
- `aggregateFlujoCajaPorMes` (`lib/dashboard/flujo-caja-agg.ts`) — descartar filas `monto === 0`
  antes de agregar (defensa en profundidad).
- Copy del popover/tooltip de "Diferencia de caja" en `caja-rows.tsx`.
- Script one-off para borrar las filas `monto = 0` que ya están en la DB.
- Tests de las funciones puras afectadas.

Fuera de alcance:

- Cambio de schema de Prisma / migración — **no hace falta** (ver sección 7).
- Cambiar la mecánica del acumulado de "Diferencia de caja" (la fórmula delta del 24-ago no se toca).
- Semántica de `monto` negativo — un negativo, si existiera, sigue siendo un arqueo válido.
  El predicado "sin dato" es `monto === 0` exacto.
- Vistas fuera del Dashboard de Resultados.

## 3. Regla de negocio (actualizada)

> Un arqueo válido es una fila de `flujo_caja_manual` con `monto ≠ 0`. Una fila con `monto = 0`
> o la ausencia de fila son ambas "sin dato" — indistinguibles y equivalentes.
>
> "Diferencia de caja" ancla en el primer mes con arqueo válido y arranca a acumular el mes
> siguiente (sin cambios respecto al 24-ago, salvo qué cuenta como "arqueo válido").
>
> Un mes con `monto = 0` entre dos arqueos válidos se trata como "sin arqueo propio" ese mes:
> no aporta variación de disponible, arrastra la referencia del último arqueo conocido (mismo
> comportamiento que hoy tiene un mes con `disponible: null`).

## 4. Arquitectura

### 4.1 `GET /api/dashboard/flujo-caja/primer-arqueo`

`app/api/dashboard/flujo-caja/primer-arqueo/route.ts` — el `where` del `findFirst` suma
`monto: { not: 0 }`:

```ts
const primera = await prisma.flujoCajaManual.findFirst({
  where: {
    monto: { not: 0 },
    ...(localId !== undefined ? { localId } : {}),
    ...(puntoDeVentaId !== undefined ? { puntoDeVentaId } : {}),
  },
  orderBy: [{ anio: "asc" }, { mes: "asc" }],
  select: { anio: true, mes: true },
});
```

Sin otros cambios en la ruta (response, auth, Zod de query params igual).

### 4.2 `GET /api/dashboard/flujo-caja`

`app/api/dashboard/flujo-caja/route.ts` — el `findMany` suma `monto: { not: 0 }` al `where`.
El resto (`aggregateFlujoCajaPorMes`, response) no cambia: los meses sin fila válida ya salen
como `null` porque `aggregateFlujoCajaPorMes` inicializa todo en `null` y solo pisa los meses
con filas.

Efecto en cascada, sin tocar `caja-rows.tsx`:
- La celda "Disponible en caja" de jun/jul/ago pasa a `value == null` → renderiza "—".
- `flujoCajaTieneDatos` (`months.some((mes) => flujoCajaPorMes[mes] != null)`) y `flujoCajaTotal`
  (`?? 0`) ya son correctos con este cambio.
- `useDiferenciaCaja` → `fetchYearTotals` → `disponiblePorMes: flujo.meses` recibe `null` para
  esos meses, que es lo que ya espera.

### 4.3 `PUT /api/dashboard/flujo-caja`

`app/api/dashboard/flujo-caja/route.ts` — branch nuevo antes del `INSERT ... ON CONFLICT`:

```ts
if (monto === 0) {
  await prisma.$executeRaw(Prisma.sql`
    DELETE FROM "flujo_caja_manual"
    WHERE "localId" IS NOT DISTINCT FROM ${localId ?? null}
      AND "puntoDeVentaId" IS NOT DISTINCT FROM ${puntoDeVentaId ?? null}
      AND "anio" = ${anio}
      AND "mes" = ${mes}
  `);
  return NextResponse.json({ ok: true });
}
```

`IS NOT DISTINCT FROM` para que el match funcione con `localId`/`puntoDeVentaId` en `null`
(consistente con el índice `NULLS NOT DISTINCT` de la migración `20260723000100`). Borrar una
fila que no existe es un no-op silencioso — `{ ok: true }` igual, el resultado observable
("no hay arqueo para ese mes") es el mismo.

El `putSchema` no cambia (`monto: z.number()` sigue aceptando 0; el 0 ahora significa "borrá").

`caja-rows.tsx` no necesita cambios en `handleSaveFlujoCaja`: `parseMontoARS("")` → `0` →
PUT con `monto: 0` → DELETE. El flujo "editar y guardar vacío" ahora limpia la celda.

### 4.4 `computeDiferenciaCajaAcumulada` (defensa en profundidad)

`lib/dashboard/resultados-calc.ts`. Con 4.1 + 4.2 la función nunca debería recibir un
`disponible: 0` de un mes real, pero se blinda igual por si un 0 entra por otra vía (import
futuro, dato manual en DB):

- La referencia inicial: `let referencia = serie[i0].disponible ?? 0;` → sin cambio de forma,
  pero `i0` ahora siempre apunta a un mes con `monto ≠ 0` por el gate de 4.1.
- Dentro del loop, cambiar la condición de "hay arqueo propio este mes" de `m.disponible != null`
  a `m.disponible != null && m.disponible !== 0` (un helper local `tieneArqueo(m)` para no
  repetir la condición en las dos ramas):

```ts
const tieneArqueo = m.disponible != null && m.disponible !== 0;
const deltaDisponible = tieneArqueo ? m.disponible! - referencia : 0;
if (tieneArqueo) referencia = m.disponible!;
acc += deltaDisponible - ((m.ingresos - m.egresos) - m.ganancia);
resultado[i] = acc;
```

Actualizar el comentario de bloque de la función para mencionar que `0` ≡ `null` ≡ "sin arqueo".

### 4.5 `aggregateFlujoCajaPorMes` (defensa en profundidad)

`lib/dashboard/flujo-caja-agg.ts` — primera línea del cuerpo:
`rows = rows.filter((r) => r.monto !== 0);`. Comentario del "por qué": un `monto = 0` es "sin
dato", no un arqueo; si el endpoint lo mandara igual, no debe contar como fila presente para
ese mes.

### 4.6 Copy en `caja-rows.tsx`

En el `PopoverContent` de "Diferencia de caja", la línea de "Sin dato":

> **Sin dato:** mes anterior o igual al primer arqueo, un mes con arqueo en $0, o directamente
> sin ningún arqueo cargado.

Sin otros cambios de UI.

### 4.7 Script de limpieza de datos (one-off)

`scripts/limpiar-flujo-caja-cero.ts` (ejecutable con `tsx`):

1. `SELECT "localId", "puntoDeVentaId", "anio", "mes", "monto" FROM "flujo_caja_manual" WHERE "monto" = 0`
   — imprime el detalle (cuántas filas, qué locales/PDV/meses).
2. **Para y pide confirmación explícita del usuario** antes de ejecutar el `DELETE`. Es dato del
   cliente (aunque `flujo_caja_manual` es arqueo manual, no compras/ventas importadas).
3. `DELETE FROM "flujo_caja_manual" WHERE "monto" = 0` — imprime el count borrado.
4. Correr en **dev primero**, verificar el dashboard, después **prod**.

El script no se auto-ejecuta como parte del deploy — es una corrida manual y puntual.

## 5. Testing (TDD — los tests van antes de la implementación)

### `lib/dashboard/resultados-calc.test.ts`

- Caso nuevo: serie con jun/jul/ago en `disponible: 0` y septiembre `disponible: 500` (primer
  arqueo real), `primerArqueo = { anio, mes: 9 }`. Esperado: `resultado` es `null` para
  jul/ago/sep, primer número en octubre. Verifica que un `0` intermedio se trata como `null`.
- Caso nuevo: un `disponible: 0` **entre** dos arqueos válidos (ej. sep=500, oct=0, nov=600) →
  oct no aporta variación, nov calcula `delta = 600 - 500 = 100` (referencia arrastrada desde
  septiembre, no reseteada a 0 en octubre).
- Los tests existentes de `computeDiferenciaCajaAcumulada` siguen pasando sin cambios (usan
  `disponible: null` para los meses sin arqueo, que sigue funcionando igual).

### `lib/dashboard/flujo-caja-agg.test.ts`

- Caso nuevo: fila con `monto: 0` para un mes → ese mes queda en `null`, no en `0`.
- Caso nuevo: mismo mes con una fila `monto: 0` y otra `monto: 1000` (dos PDV) → agrega solo
  la de 1000.

### Endpoints

- `primer-arqueo` y el GET/PUT de `flujo-caja` son queries directas de Prisma sin lógica de
  transformación — mismo criterio que el 24-ago: sin test unitario propio, se cubren por code
  review + verificación manual contra datos reales.
- Verificación manual obligatoria antes de cerrar: en San Justo 2025, tras correr el script de
  limpieza en dev, jun/jul/ago muestran "—" en "Disponible en caja" y "Diferencia de caja"
  arranca en octubre.

## 6. Criterios de aceptación

| CA | Descripción | Cubierto por |
|----|-------------|--------------|
| CA-01 | jun/jul/ago (sin arqueo real) → "Disponible en caja" muestra "—", no "$ 0,00" | 4.2 + script 4.7 |
| CA-02 | "Diferencia de caja" arranca en octubre (mes siguiente al primer arqueo real de septiembre) | 4.1 + 4.4 |
| CA-03 | Guardar una celda de "Disponible en caja" con el campo vacío deja la celda en "—" (borra la fila) | 4.3 |
| CA-04 | Un arqueo real de `monto ≠ 0` sigue anclando el cálculo como antes | 4.1 (tests existentes siguen verdes) |
| CA-05 | Un `monto = 0` entre dos arqueos válidos no rompe el arrastre del acumulado | 4.4 (test nuevo) |
| CA-06 | La vista agregada "todos los locales / todos los PDV" no suma filas `monto = 0` | 4.5 (test nuevo) |

## 7. Schema / migración

**Ninguna.** `monto` sigue siendo `Decimal` no-nullable. "Sin dato" se representa con la
ausencia de fila (como hasta ahora); lo único que cambia es que ahora también se borra la fila
cuando el valor es `0`, y que `0` se filtra en lectura. No hace falta un `monto` nullable ni un
flag `esArqueoValido` — YAGNI, la ausencia de fila ya alcanza.

## 8. Riesgos / notas

- **Contradice el spec del 24-ago.** Actualizar `project_fix_diferencia_caja_spec.md` en memoria
  para reflejar la decisión nueva ("$0 nunca es arqueo válido") y evitar que un agente futuro
  reintroduzca el criterio viejo.
- **Dato financiero visible al cliente** — la verificación de cierre es visual contra San Justo
  2025 real, no solo los tests unitarios.
- El script de limpieza toca datos almacenados del cliente — corrida manual con confirmación
  explícita, dev antes que prod.
- Si Diego más adelante necesita registrar una caja genuinamente en $0 como un hecho contable,
  esto vuelve a ser una pregunta de diseño (haría falta el `monto` nullable o el flag) — hoy,
  por decisión suya, no es un caso real.
