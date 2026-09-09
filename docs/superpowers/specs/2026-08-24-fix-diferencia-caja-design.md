# Fix — Diferencia de caja: gate del primer arqueo + modelo acumulado

**Fecha:** 2026-08-24
**Reportado por:** Diego Sebastián Albo (audio 21-ago-2026 + doc `Fix_Diferencia_Caja.pdf`)
**Prioridad:** Alta — afecta la lectura del resultado del negocio en el Dashboard de Resultados
**Memoria relacionada:** `project_fix_diferencia_caja_spec.md`

## 1. Contexto

La fila "Diferencia de caja" del Dashboard de Resultados muestra hoy un valor para todos los
meses, incluso los que nunca tuvieron un "Disponible en caja" (arqueo manual) cargado. Diego
reportó 3 valores visibles como incorrectos.

**Regla de negocio (textual de Diego):** *"Cuando no hay disponible de caja cargado, la
diferencia de caja no la tiene que hacer. El arqueo sirve como caja inicial para el próximo mes,
esa es la mecánica."* El arqueo de un mes representa la caja de arranque del mes **siguiente**,
no el resultado del mes en que se carga. Por eso "Diferencia de caja" solo tiene sentido a partir
del mes siguiente al primer arqueo cargado — antes de eso no hay caja inicial conocida.

### Hallazgo de esta sesión — por qué el código actual no cumple esto

El código actual (`hooks/use-diferencia-caja.ts` + `diferenciaCajaMensual` en
`lib/dashboard/resultados-calc.ts`) es un **delta independiente mes a mes**: compara el
Disponible del mes actual contra el del mes anterior, y devuelve `null` si falta cualquiera de
los dos. No cumple CA-03 (ver sección 6) porque un mes sin arqueo propio corta la cadena para
todos los meses siguientes, no solo para sí mismo.

El PDF (sección 5.3) asume que existe un "cálculo acumulado ya existente... que no cambia su
lógica interna, solo el punto de inicio". Ese modelo acumulado (`hooks/use-diferencia-caja-acumulada.ts`
+ `computeDiferenciaCajaAcumulada` en `resultados-calc.ts`) existió en el repo pero **fue
eliminado por el commit `38b8068`** (13-ago-2026), reemplazado por el modelo delta actual. La
razón documentada del commit fue que el acumulado "se disparaba en 2026". Revisando el código
eliminado (`git show 38b8068~1:...`), la causa real no era la acumulación en sí, sino que
`diferenciaCaja()` trataba el Disponible faltante como `0` (`?? 0`) para **todos** los meses,
incluidos los anteriores a cualquier arqueo real — sumando meses "fantasma" desde el arranque de
los datos. Este fix reintroduce el modelo acumulado, pero con el gate del primer arqueo que
nunca tuvo, resolviendo ambos problemas a la vez.

## 2. Alcance

Dentro de alcance:
- Nuevo endpoint para ubicar el primer arqueo cargado.
- Reemplazo de `diferenciaCajaMensual` por una función acumulada con gate.
- Extensión de `useDiferenciaCaja` para orquestar el fetch multi-año cuando el primer arqueo
  está en un año anterior al visualizado.
- Cambio del total anual en `caja-rows.tsx` de "suma de deltas visibles" a "último mes
  acumulado válido del año".
- Actualización/reemplazo de los tests existentes de `diferenciaCajaMensual` (quedan obsoletos,
  la función desaparece).

Fuera de alcance:
- Cualquier cambio a la carga/edición de "Disponible en caja" (`FlujoCajaManual`, `PUT
  /api/dashboard/flujo-caja`) — no se toca.
- Cualquier cambio de schema de Prisma o migración — la query nueva es de solo lectura sobre
  `FlujoCajaManual`, sin cambios de estructura.
- Vistas fuera del Dashboard de Resultados.

## 3. Arquitectura

Tres piezas, siguiendo el patrón ya existente en el hook (orquestación client-side vía
TanStack Query combinando varios endpoints JSON) — no se centraliza el cálculo en el servidor
para no arrastrar un refactor de los endpoints de pivot/ventas/compras que hoy alimentan este
hook, fuera de alcance de este fix.

```
┌─────────────────────────────┐     ┌──────────────────────────────┐
│ GET /api/dashboard/          │────▶│ useDiferenciaCaja(year, ...)  │
│ flujo-caja/primer-arqueo     │     │  1. resuelve primerArqueo     │
│ (nuevo, findFirst en Prisma) │     │  2. fetchYearTotals × N años  │
└─────────────────────────────┘     │  3. computeDiferenciaCaja     │
                                     │     Acumulada (función pura)  │
                                     └───────────────┬────────────────┘
                                                      ▼
                                     ┌──────────────────────────────┐
                                     │ caja-rows.tsx                │
                                     │  fila mensual + total anual  │
                                     └──────────────────────────────┘
```

### 3.1 Endpoint nuevo — ubicar el primer arqueo

`GET /api/dashboard/flujo-caja/primer-arqueo?localId=&puntoDeVentaId=`

- Mismo filtro condicional que ya usa `GET /api/dashboard/flujo-caja` (localId/puntoDeVentaId
  opcionales — sin ninguno de los dos, busca entre todos los locales, igual que la vista
  agregada actual).
- `FlujoCajaManual.monto` es un campo no-nullable en el schema — una fila solo existe si el
  usuario cargó un valor. Por eso "primer arqueo" es simplemente la primera fila que matchea el
  filtro, ordenada por `(anio, mes)` ascendente — sin necesidad de filtrar por `monto IS NOT
  NULL`.
- Query: `prisma.flujoCajaManual.findFirst({ where: {...filtro...}, orderBy: [{ anio: "asc" },
  { mes: "asc" }], select: { anio: true, mes: true } })`.
- Response: `{ primerArqueo: { anio: number; mes: number } | null }`.
- Requiere `requireAuth()`, igual que el resto de las rutas de `/api/dashboard`.
- No necesita Zod para el body (no lo tiene) — sí para query params (`localId`/
  `puntoDeVentaId` opcionales, `z.coerce.number().int()`), mismo patrón que el GET existente.

### 3.2 Función pura — cálculo acumulado con gate

Reemplaza `diferenciaCajaMensual`. Vive en `lib/dashboard/resultados-calc.ts`.

```ts
export interface MesDatos {
  anio: number;
  mes: number;
  ingresos: number;
  egresos: number;
  ganancia: number;
  disponible: number | null;
}

// Recibe la serie continua y ordenada (anio, mes) desde el año del primer arqueo hasta el
// año objetivo, inclusive. `primerArqueo` debe pertenecer a esa serie (mismo anio/mes que
// algún elemento). Devuelve el mismo largo que `serie`, indexado por posición.
export function computeDiferenciaCajaAcumulada(
  serie: MesDatos[],
  primerArqueo: { anio: number; mes: number } | null,
): (number | null)[]
```

Lógica (mapea 1:1 al pseudocódigo del PDF, sección 4):
- Si `primerArqueo === null` → array de `null`, mismo largo que `serie`. (CA-01)
- Busca el índice `i0` en `serie` donde `(anio, mes) === primerArqueo`. Si `primerArqueo` es
  posterior al último elemento de `serie` (no debería pasar si el caller arma bien la serie,
  pero se cubre igual) → todo `null`.
- Para `i <= i0` (inclusive el mes del primer arqueo) → `null`. (CA-02, CA-04)
- Para `i > i0`: `saldoInicial = serie[i0].disponible` (el disponible del mes del primer
  arqueo — no debería ser `null` ahí por construcción, pero si lo fuera por alguna
  inconsistencia de datos, tratarlo como `0` para no romper el acumulado). Acumula:
  `acc = saldoInicial; para cada mes desde i0+1: acc += (ingresos - egresos) - ganancia +
  (disponible ?? 0); resultado[i] = acc`. (CA-03 — un mes sin `disponible` propio sigue
  sumando, solo aporta `0` de ese término, no corta la cadena)

Esta función es pura y se testea igual que la vieja `computeDiferenciaCajaAcumulada` que existió
antes del 13-ago — sin fetch, sin React.

### 3.3 Hook — orquestación multi-año

`useDiferenciaCaja({ year, localId, pdvId })` en `hooks/use-diferencia-caja.ts`, reescrito:

1. Query nueva: `primerArqueo` vía el endpoint 3.1.
2. Si `primerArqueo` es `null`, o `primerArqueo.anio > year` → devuelve `diferenciaPorMes` con
   los 12 meses en `null`, sin disparar ninguna otra query (corte temprano, CA-01 barato).
3. Si no, `años = [primerArqueo.anio, ..., year]` (rango inclusive) y hace `Promise.all` de
   `fetchYearTotals(año, localId, pdvId)` (la función ya existente, sin cambios) para cada año
   del rango vía `useQueries`.
4. Con todos los años resueltos, arma `serie: MesDatos[]` concatenando los 12 meses de cada año
   en orden, y llama a `computeDiferenciaCajaAcumulada(serie, primerArqueo)`.
5. Devuelve solo los meses de `year` (recorta la serie al año pedido para el return), igual que
   hoy — el resto de la serie fue necesaria solo para arrastrar el acumulado.

`FIRST_DATA_YEAR` y `fetchDiciembreAnterior` dejan de ser necesarios para este hook (el
acumulado cross-año ahora se resuelve con la serie continua, no con un fetch puntual de
diciembre) — se eliminan de este archivo.

No hay límite artificial de cuántos años puede abarcar el rango — el volumen es chico por
naturaleza del negocio (los datos arrancan en 2025), no se justifica una guarda por YAGNI.

**Contrato de retorno** (no cambia respecto a hoy, para no romper `caja-rows.tsx` más de lo
necesario): `{ diferenciaPorMes: Record<number, number | null>, isLoading: boolean, isError:
boolean }`. `isLoading` es `true` si la query de `primerArqueo` o cualquiera de las queries de
`fetchYearTotals` en curso están cargando. `isError` es `true` si `primerArqueo` o cualquiera
de los `fetchYearTotals` fallaron.

### 3.4 UI — `caja-rows.tsx`

- La fila mensual (líneas 178-191 actuales) no cambia de estructura — sigue leyendo
  `diferenciaPorMes[mes]`, ya viene con el gate aplicado.
- El total anual (líneas 192-206 actuales) cambia de "sumar los meses visibles no-null" a
  "último mes del año con valor no-null" (recorriendo `months` de atrás para adelante y
  tomando el primer no-null). Si ningún mes tiene valor → `—`. (CA-05, sección 5.4 del PDF)
- El tooltip del total (`title="Suma de los meses visibles con arqueo cargado"`) cambia a algo
  como `"Saldo acumulado al último mes con cálculo válido"`.
- El tooltip de la fila (línea 146, `title="Variación del disponible en caja del mes menos el
  resultado societario del mes (no acumulado)"`) y el texto del popover (líneas 157-173,
  "Diferencia de caja = variación de la caja − (Resultado OP − Ganancia)") ya no describen la
  fórmula real — se actualizan al texto de la sección 7 del PDF: "Diferencia de caja (mes) =
  Resultado OP − Ganancia + Disponible en caja, acumulado mes a mes desde el primer arqueo."

## 4. Testing

- `resultados-calc.test.ts`: se eliminan los tests de `diferenciaCajaMensual` (función
  desaparece, incluidos los dos "fixture real del PDF" que validaban el modelo delta viejo —
  ya no aplican a un modelo acumulado). Se agregan tests de `computeDiferenciaCajaAcumulada`
  cubriendo CA-01 a CA-04 explícitamente como casos, más el caso cross-año (primer arqueo en
  un año anterior al primer elemento visible de la serie recortada).
- `flujo-caja-agg.test.ts` (si existe, o el archivo de test correspondiente): no cambia, la
  función que testea no se toca.
- El endpoint nuevo (3.1) no lleva test unitario propio — es una query directa de Prisma sin
  lógica de transformación (mismo criterio que ya se usó para `import_logs`, ver
  `project_import_logs_deuda_migraciones.md`).
- El hook (3.3) no lleva test unitario propio (no hay infraestructura de test de hooks React
  con TanStack Query en este repo hoy) — se verifica por code review + verificación manual
  contra datos reales, igual que el resto de los hooks de este dashboard.

## 5. Criterios de aceptación (trazabilidad al PDF, sección 6)

| CA | Cubierto por |
|----|--------------|
| CA-01 — sin arqueo → todo vacío | Hook paso 2 (corte temprano) + función pura caso `primerArqueo === null` |
| CA-02 — primer mes de cálculo correcto | Función pura, gate en `i <= i0` |
| CA-03 — continuidad sin arqueo posterior | Función pura, `disponible ?? 0` solo para `i > i0` |
| CA-04 — celda vacía vs. cero | Función pura devuelve `null` (no `0`) fuera de rango; UI ya renderiza `null` como `—` (sin cambios en ese punto) |
| CA-05 — cambio de período recalcula | Hook recalcula `primerArqueo`/`años`/serie en cada cambio de `year` (React Query re-ejecuta con la key nueva) |

> **Actualización 2026-09-09:** la parte de *display* de CA-03 fue revertida por
> `2026-09-09-diferencia-caja-gate-por-arqueo-y-endpoint-unico.md`. Un mes sin arqueo
> cargado ahora muestra "—", no el acumulado corriente. La *continuidad* de CA-03 (el
> acumulador no se corta en meses sin arqueo) se mantiene: un arqueo posterior sigue
> reconciliando contra el anterior.

## 6. Riesgos / notas

- Dato financiero visible al cliente — cualquier discrepancia en la fórmula o el gate se nota
  de inmediato en el dashboard. Verificación manual contra los valores reales que Diego señaló
  como incorrectos es el criterio de cierre, no solo los tests unitarios.
- El endpoint nuevo es de solo lectura, sin riesgo sobre datos existentes.
