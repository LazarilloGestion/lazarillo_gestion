# Corrección — Diferencia de caja: por mes, no acumulada

**Fecha:** 2026-09-16
**Reportado por:** Diego Sebastián Albo (`Correccion_diferencia_caja_por_mes.pdf`, 07/09/2026)
**Prioridad:** Alta — el modelo acumulado esconde faltantes de caja reales detrás del colchón de meses anteriores
**Specs relacionados:** `2026-08-24-fix-diferencia-caja-design.md` (introdujo el modelo acumulado), `2026-09-09-diferencia-caja-gate-por-arqueo-y-endpoint-unico.md` (fix de display "—" y endpoint único — este documento NO lo revierte)
**Memoria relacionada:** `project_fix_diferencia_caja_spec.md`

## 1. Contexto

### 1.1 La falla observada

El fix del 09-sep (mes sin arqueo → "—") quedó bien. Lo que Diego señala ahora es la **mecánica del cálculo**: hoy cada celda con valor muestra el acumulado corrido desde el primer arqueo de la historia; la definición real es que cada celda sea la diferencia **del mes, independiente** de los demás meses.

El propio doc trae un caso de prueba con datos reales de San Justo (sep-2025 → jul-2026): la fila "Acumulado" reproduce exacto lo que muestra hoy el panel; la fila "Por mes" es el resultado esperado. Dos meses quedan marcados como bug real que el acumulado esconde — Mar-26 (faltaron $2,8M en caja) y Jul-26 (faltaron $4,6M) — porque el colchón de meses anteriores con superávit los deja en verde en la vista acumulada.

### 1.2 Fórmula nueva

```
Diferencia del mes = (Arqueo del mes − Arqueo del mes anterior con arqueo) − (Resultado OP del mes − Ganancia del mes)
```

- "Arqueo del mes anterior" es el **último mes con arqueo cargado** (no necesariamente el mes calendario inmediato anterior) — mismo criterio de continuidad cross-año que ya existe (enero compara contra diciembre del año anterior).
- Primer arqueo de la historia y meses sin arqueo → "—" (sin cambios, spec 2026-09-09).

### 1.3 Decisión — huecos multi-mes (confirmada con el usuario, 2026-09-16)

Cuando el arqueo vuelve a aparecer después de un hueco de 2+ meses sin arqueo, el término contable que se resta es **solo el del mes que cierra el hueco** — no la suma de Resultado OP − Ganancia de los meses intermedios. Es la lectura literal de la fórmula del PDF ("Resultado OP del mes", singular).

Esto es una diferencia real de comportamiento contra el modelo acumulado actual: hoy `acc` suma el término contable de **todos** los meses desde el primer arqueo, se muestren o no; bajo la fórmula nueva, el resultado operativo de los meses ocultos del hueco no entra en el cálculo del mes que reabre. San Justo no tiene huecos reales (arqueo cargado todos los meses desde jun-2025), así que el fixture del PDF no distingue entre ambas interpretaciones — la decisión quedó en manos del usuario y se resuelve como arriba.

### 1.4 Total anual y tooltip (confirmado con el usuario, 2026-09-16)

- **Total anual:** pasa de "último valor acumulado del año" a **suma de los valores mensuales visibles** (los que no son "—"). Coincide con lo que sugiere el PDF y es consistente con que cada celda ya es independiente.
- **Acumulado como dato secundario:** el PDF sugiere agregar el acumulado desde el primer arqueo como línea extra del tooltip. Va **por celda mensual** (no solo en el total): cada celda con valor muestra, al pasar el mouse, el acumulado corrido hasta ese mes — preserva la lectura "resumen bancario" que tenía la mecánica vieja, ahora como información secundaria.

## 2. Alcance

**Dentro:**

- `lib/dashboard/resultados-calc.ts` — función nueva `computeDiferenciaCajaPorMes`, calculada en el mismo recorrido que la existente `computeDiferenciaCajaAcumulada` (que no cambia su lógica, solo pasa a ser la fuente del dato de tooltip).
- `lib/dashboard/diferencia-caja-serie.ts` — `buildDiferenciaCajaSerie` cambia su tipo de retorno para incluir ambos valores por mes.
- `app/api/dashboard/diferencia-caja/route.ts` — mismo shape nuevo en la respuesta; sin cambios de queries SQL.
- `hooks/use-diferencia-caja.ts` — actualizado al nuevo shape.
- `components/dashboard/caja-rows.tsx` — celda mensual con `title` de acumulado, total anual = suma, popover reescrito.
- Tests: `resultados-calc.test.ts` (fixture real de San Justo del PDF + caso de hueco multi-mes), `diferencia-caja-serie.test.ts` (nuevo shape).

**Fuera:**

- El fix de display del 09-sep (mes sin arqueo → "—") — no se toca, sigue vigente.
- I-3 (mapas dispersos, `?? 0` vs "sin dato") — sigue documentada, no resuelta; el cambio no la agrava ni la mejora de forma relevante porque el término contable de un mes sin arqueo dejado fuera del hueco nunca se suma bajo la fórmula nueva (a diferencia del modelo acumulado, que sí lo arrastraba).
- Carga/edición de "Disponible en caja" (`FlujoCajaManual`, `PUT /api/dashboard/flujo-caja`) — no se toca.
- Cambios de schema de Prisma o migraciones — todo el cambio es de cálculo puro + shape de respuesta de un endpoint de solo lectura.
- Los endpoints de pivot existentes — sin cambios.

## 3. Arquitectura

### 3.1 `lib/dashboard/resultados-calc.ts`

`computeDiferenciaCajaAcumulada` **no cambia una línea** — sigue calculando exactamente lo que calcula hoy (el acumulado corrido, gateado por arqueo real para el display). Pasa a usarse solo como fuente del dato de tooltip.

Función nueva:

```ts
// Diferencia de caja POR MES (spec 2026-09-16, reemplaza el acumulado como valor principal).
// Cada mes con arqueo es independiente: valor = (arqueo - referencia) - término contable DEL MES
// ACTUAL únicamente. `referencia` (último arqueo real conocido) se arrastra igual que en
// computeDiferenciaCajaAcumulada — mismo criterio de "$0/null = sin dato" (spec 2026-08-31).
//
// Decisión confirmada 2026-09-16: en un hueco de 2+ meses sin arqueo, el término contable que se
// resta al cerrar el hueco es SOLO el del mes que cierra, no la suma de los meses ocultos — lectura
// literal de la fórmula del PDF. Esto difiere del modelo acumulado (que sí arrastra el término
// contable de los meses ocultos); es una decisión de negocio, no un bug.
export function computeDiferenciaCajaPorMes(
  serie: MesDatos[],
  primerArqueo: { anio: number; mes: number } | null,
): (number | null)[] {
  const resultado: (number | null)[] = serie.map(() => null);
  if (primerArqueo == null) return resultado;

  const i0 = serie.findIndex((m) => m.anio === primerArqueo.anio && m.mes === primerArqueo.mes);
  if (i0 === -1) return resultado;

  let referencia = serie[i0].disponible ?? 0;
  for (let i = i0 + 1; i < serie.length; i++) {
    const m = serie[i];
    const arqueo = m.disponible !== 0 ? m.disponible : null;
    if (arqueo == null) continue; // referencia no se toca; resultado[i] queda null
    const deltaDisponible = arqueo - referencia;
    referencia = arqueo;
    resultado[i] = deltaDisponible - ((m.ingresos - m.egresos) - m.ganancia);
  }
  return resultado;
}
```

Nota de diseño: a diferencia de `computeDiferenciaCajaAcumulada`, este loop no necesita tocar nada en los meses sin arqueo (ni `acc` ni el término contable de ese mes) — es justamente la ausencia de ese arrastre lo que define "por mes, independiente".

### 3.2 `lib/dashboard/diferencia-caja-serie.ts`

```ts
export interface DiferenciaCajaMes {
  valor: number | null;      // "por mes" — lo que se muestra en la celda
  acumulado: number | null;  // acumulado desde el primer arqueo — dato secundario de tooltip
}

export function buildDiferenciaCajaSerie(input: {
  year: number;
  primerArqueo: { anio: number; mes: number } | null;
  totalesPorAnio: Record<number, TotalesAnio>;
}): Record<number, DiferenciaCajaMes>
```

- Arma `serie: MesDatos[]` igual que hoy.
- Corre `computeDiferenciaCajaPorMes(serie, primerArqueo)` y `computeDiferenciaCajaAcumulada(serie, primerArqueo)` sobre la misma `serie`.
- Recorta ambos arrays al `year` pedido con el mismo offset multi-año que hoy.
- Sin arqueo o `primerArqueo.anio > year` → los 12 meses en `{ valor: null, acumulado: null }`.

Sigue siendo puro: sin fetch, sin Prisma, sin React.

### 3.3 `app/api/dashboard/diferencia-caja/route.ts`

- `diferenciaVacia()` devuelve `Record<number, DiferenciaCajaMes>` con `{ valor: null, acumulado: null }` por mes.
- El resto de la orquestación (auth, Zod, guarda de fan-out, las 4 queries agregadas por año) no cambia.
- Response: `{ diferenciaPorMes: Record<number, DiferenciaCajaMes> }`.

### 3.4 `hooks/use-diferencia-caja.ts`

```ts
interface DiferenciaCajaResponse {
  diferenciaPorMes: Record<number, DiferenciaCajaMes>;
}
```

El hook devuelve `diferenciaPorMes: Record<number, DiferenciaCajaMes>` (antes `Record<number, number | null>`); mismo fallback a `{ valor: null, acumulado: null }` por mes ausente. `isLoading`/`isError` sin cambios.

### 3.5 UI — `caja-rows.tsx`

- **Celda mensual:** `diferenciaPorMes[mes].valor` en vez de `diferenciaPorMes[mes]` directo. `title` de la celda: si `valor != null`, `` `Acumulado desde el primer arqueo: ${fmtARS(acumulado)}` ``; si `valor == null`, sin cambios (o el título de error existente).
- **Total anual:** de "último mes con valor" pasa a `months.reduce((acc, mes) => diferenciaPorMes[mes].valor != null ? acc + diferenciaPorMes[mes].valor : acc, null as number | null)` — arranca en `null` (sin dato) y se vuelve número en cuanto aparece el primer mes con valor, para no confundir "$0 real" con "sin ningún mes cargado". `title` del total: `"Suma de los meses con arqueo cargado"`.
- **Popover de la fórmula:** reescribir el texto:
  - Título: `Diferencia de caja (mes) = (Arqueo del mes − Arqueo del mes anterior) − (Resultado OP − Ganancia)`.
  - Cuerpo: cada mes es independiente; "mes anterior" es el último con arqueo cargado (continuidad entre años incluida); el acumulado desde el primer arqueo está disponible al pasar el mouse sobre cada celda.
  - Se quita la frase "se acumula mes a mes como un resumen bancario" (ya no describe el comportamiento).
- **Invalidación de query (`["diferencia-caja"]`)** — sin cambios, mismo prefijo.

## 4. Testing

- **`lib/dashboard/resultados-calc.test.ts`** (`computeDiferenciaCajaPorMes`, nuevo):
  - Fixture real de San Justo del PDF (sep-2025 → jul-2026, fila "Por mes" completa) como caso principal — sin huecos, valida la fórmula base.
  - Caso de hueco multi-mes (2+ meses sin arqueo): el mes que reabre usa solo su propio término contable, no la suma del hueco (valida la decisión de §1.3); `referencia` salta directo del último arqueo real al nuevo, sin pasar por los meses del medio.
  - CA-01, CA-02, CA-04 (sin arqueo, mes del primer arqueo, antes del primer arqueo → `null`) y el criterio "$0 = sin dato" (spec 2026-08-31) — mismos casos que ya cubre `computeDiferenciaCajaAcumulada`, adaptados a la función nueva.
  - Caso cross-año (primer arqueo en año anterior) con arqueo en diciembre y enero — confirma que "mes anterior" cruza el límite de año.
  - `computeDiferenciaCajaAcumulada`: sin cambios de expectativa en ningún test existente (la función no cambió).
- **`lib/dashboard/diferencia-caja-serie.test.ts`:**
  - Actualizar todas las aserciones al nuevo shape `{ valor, acumulado }`.
  - Caso nuevo: verificar que `acumulado` de una celda coincide con lo que hoy devuelve `computeDiferenciaCajaAcumulada` para ese mismo mes (no diverge del comportamiento pre-existente).
- **Endpoint / hook:** sin test unitario propio, mismo criterio que specs anteriores (cubierto por los helpers puros + code review).
- **Verificación de cierre:** correr el fixture completo de San Justo del PDF como test determinístico (ya lo trae Diego, no hace falta pegarle a producción) — confirmar que los 10 valores mensuales "Por mes" coinciden exacto, y que Mar-26/Jul-26 aparecen con sus valores negativos reales (ya no tapados por el acumulado).

## 5. Riesgos / notas

- **Cambio de comportamiento en huecos, no solo de display.** A diferencia del fix del 09-sep (que solo cambiaba qué se dibuja, preservando la continuidad interna), este cambio altera el **resultado numérico** que se muestra cuando hay un hueco multi-mes — el resultado operativo de los meses ocultos deja de entrar en el cálculo. San Justo no tiene huecos reales hoy, así que no hay forma de verificar esto contra datos de producción; queda cubierto solo por el test unitario de §4. Si en el futuro aparece un hueco real (Ramos Mejía, San Justo, o un local nuevo) y el número no coincide con lo que Diego espera, es candidato a revisar esta decisión, no un bug de implementación.
- **Dato financiero visible al cliente.** Mismo criterio que specs anteriores: cualquier discrepancia se nota de inmediato: el fixture de San Justo del PDF es el criterio de cierre no negociable.
- **I-3 sigue viva**, documentada en el mismo lugar (`diferencia-caja-serie.ts`).
- **Sin migración de Prisma, sin cambio de queries SQL** — todo el cambio vive en cálculo puro + shape de respuesta de un endpoint de solo lectura.
