# Promoción de `dev` a `main` — corte de duplicados Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Nota para quien ejecute este plan (humano o agente):** a diferencia de los planes anteriores de este repo, esto NO es desarrollo de software con TDD — es una secuencia lineal de operaciones de git/build/deploy sobre trabajo ya escrito y ya verificado (tests/lint/tsc limpios). Las Tasks 1-3 son estrictamente secuenciales (cada una depende del resultado exacto de la anterior) y las Tasks 4-6 requieren acceso humano a Vercel/producción que ningún agente tiene — por eso se recomienda ejecución **inline** en la misma conversación en vez de subagent-driven-development. Ver la sección "Elección de ejecución" al final.

**Goal:** Cortar la fuente de nuevos duplicados de compras en producción promoviendo el código de `dev` (que ya usa el esquema de identidad de compra correcto) a `main` (la rama deployada en Vercel que el cliente usa, que todavía calcula el `rowId` con el esquema viejo).

**Architecture:** `origin/main` es un ancestro directo de `dev` (confirmado: `git merge-base --is-ancestor origin/main HEAD` → true, sin commits propios de `main` ausentes en `dev`). No hay reconciliación de historias divergentes que hacer — la corrección es un fast-forward de `main` al commit actual de `dev` (una vez que se sume el pulido de esta sesión), vía push directo sin PR intermedio (decisión explícita del usuario).

**Tech Stack:** Next.js 16 + Prisma 7 + git + Vercel (deploy automático por push a `main`).

**Spec:** `docs/superpowers/specs/2026-08-21-promocion-main-fix-duplicados-design.md`

## Global Constraints

- Sin PR intermedio — push directo a `main` (decisión explícita del usuario en la spec, sección 3).
- Se incluye el pulido de esta sesión sobre el modal de Apertura de Gastos, no solo el último commit ya pusheado de Fase D (spec sección 3).
- No se toca ningún dato de compras/ventas ya importado como parte de este trabajo — es una promoción de código, no una migración ni una limpieza de datos (spec sección 5).
- No se corre ninguna migración de Prisma — el schema de producción ya está migrado desde sesiones anteriores; `npm run build` solo corre `prisma generate` (spec sección 5).
- Cualquier `--force` sobre `main` (rollback) requiere confirmación explícita del usuario en el momento, no está pre-autorizado por este plan (spec sección 5).
- Commit de referencia de `main` antes de esta promoción (para rollback): `38b8068` (`fix(dashboard): corrige fórmula de Diferencia de caja y unifica colores de Resultados`).

---

### Task 1: Commitear y pushear el pulido de hoy a `dev`

**Files:**
- Modify (ya modificados en el working tree, sin commitear): `components/dashboard/apertura-destino-row.tsx`, `components/dashboard/apertura-gastos-modal.tsx`, `components/dashboard/apertura-timeline.tsx`, `components/dashboard/apertura-vigencia-selector.tsx`, `components/ui/dialog.tsx`, `lib/apertura/schemas.ts`, `lib/apertura/schemas.test.ts`, `lib/apertura/validaciones.ts`, `lib/apertura/validaciones.test.ts`

**Interfaces:** N/A — este task no define ni consume interfaces de código, es una operación de git sobre cambios ya escritos y verificados (280/280 tests, `tsc`, lint limpios en esta sesión).

- [ ] **Step 1: Revisar qué queda incluido**

```bash
git status --porcelain
git diff --stat
```

Expected: exactamente los 9 archivos listados arriba en "Files", sin ningún otro archivo modificado o sin trackear.

- [ ] **Step 2: Stage y commit**

```bash
git add components/dashboard/apertura-destino-row.tsx components/dashboard/apertura-gastos-modal.tsx components/dashboard/apertura-timeline.tsx components/dashboard/apertura-vigencia-selector.tsx components/ui/dialog.tsx lib/apertura/schemas.ts lib/apertura/schemas.test.ts lib/apertura/validaciones.ts lib/apertura/validaciones.test.ts

git commit -m "$(cat <<'EOF'
fix(apertura-gastos): bloquea destinos superpuestos y corrige inputs numéricos del modal

- lib/apertura/validaciones.ts: encontrarDestinoDuplicado ahora usa
  destinosSuperpuestos — "todo el local" y cualquier punto de venta
  específico de ese local compiten por la misma plata, no solo el
  duplicado exacto de local+PDV.
- lib/apertura/schemas.ts: el schema de crear/editar regla rechaza
  destinos superpuestos (defensa en profundidad, mismo criterio que
  la suma de porcentajes).
- apertura-destino-row.tsx: deshabilita en el Select las combinaciones
  ya superpuestas por otra fila; los inputs de % y $ ahora commitean
  0 en vez de revertir al valor anterior cuando se vacían.
- apertura-gastos-modal.tsx: tope real de "Agregar destino" (máximo
  de combinaciones sin superposición, no la suma ingenua de todas),
  texto "Falta: ..." bajo el botón deshabilitado, color de "Suma"
  neutro hasta que el usuario toca el formulario, panel visual para
  el bloque de Destinos, separador entre secciones.
- apertura-timeline.tsx: label "Vigencia de esta regla", tooltip real
  en los segmentos (antes title HTML), forma de píldora.
- apertura-vigencia-selector.tsx: Switch de shadcn en vez de checkbox
  nativo (mismo componente que ya usa rubros-config-modal.tsx).
- dialog.tsx: corrige el margen asimétrico del botón de cerrar.
EOF
)"
```

Expected: commit creado sin errores de hook.

- [ ] **Step 3: Push a origin/dev**

```bash
git push origin dev
```

Expected: push exitoso (fast-forward), sin rechazo.

- [ ] **Step 4: Verificar**

```bash
git log -1 --oneline origin/dev
git log -1 --oneline HEAD
```

Expected: ambos comandos muestran el mismo commit recién creado.

---

### Task 2: Build de producción real

**Files:** ninguno — este task no modifica código, solo verifica.

**Interfaces:**
- Consumes: el commit de `dev` producido en Task 1.
- Produces: confirmación de que ese commit es seguro para promover a `main` en Task 3.

- [ ] **Step 1: Correr el build**

```bash
npm run build
```

Expected: termina con exit code 0, sin errores de TypeScript ni de Next. `npm run build` ya corre `prisma generate` antes del build (ver `package.json`), así que este paso también valida que el Prisma Client generado coincide con `prisma/schema.prisma` actual.

- [ ] **Step 2: Si falla, STOP**

Si el build falla: no avanzar a Task 3 bajo ninguna circunstancia. Diagnosticar y arreglar el error (puede requerir volver a Task 1 con un commit de fix adicional), y repetir este Task 2 hasta que el build termine limpio.

---

### Task 3: Push directo `dev` → `main`

**Files:** ninguno.

**Interfaces:**
- Consumes: el commit de `dev` ya verificado por el build de Task 2.
- Produces: `main` apuntando al mismo commit que `dev` — esto es lo que Vercel toma para el próximo deploy.

- [ ] **Step 1: Confirmación final explícita**

Este es el paso más sensible del plan — push directo a la rama que el cliente usa en producción, sin PR intermedio. Antes de ejecutar el Step 2, confirmar con el usuario en el momento ("¿dale, empujo ahora?") aunque la spec ya lo dejó aprobado — es la última oportunidad de frenar antes de una acción sobre rama compartida.

- [ ] **Step 2: Push**

```bash
git push origin dev:main
```

Expected: push exitoso, reportado como fast-forward (`38b8068..<nuevo-commit>  dev -> main`). Si Git reporta que necesita `--force` o rechaza el push por "non-fast-forward", DETENERSE — eso significaría que `main` tiene un commit que no esperábamos (contradice lo ya verificado en la spec de que `origin/main` es ancestro directo de `dev`) y hay que investigar antes de forzar nada.

- [ ] **Step 3: Verificar**

```bash
git log -1 --oneline origin/main
```

Expected: mismo commit que `origin/dev` (verificado en Task 1, Step 4).

---

### Task 4: Verificación de deploy en Vercel (requiere al usuario)

**Files:** ninguno.

**Interfaces:**
- Consumes: el push a `main` de Task 3, que dispara el deploy automático de Vercel.
- Produces: confirmación humana de que el deploy fue exitoso, antes de pasar a la verificación funcional de Task 5.

- [ ] **Step 1: Pedirle al usuario que abra el dashboard de Vercel**

El agente no tiene acceso al dashboard de Vercel — este step requiere que el usuario lo confirme directamente. Preguntarle: "¿el deploy contra el nuevo `main` en Vercel terminó en verde?"

- [ ] **Step 2: Si el deploy falla — procedimiento de rollback**

Si el usuario reporta que el deploy falló o quedó en un estado roto:

```bash
git push origin 38b8068692768768c347afe4c9d935c2312661d0:main --force
```

**Esto requiere confirmación explícita del usuario en el momento antes de ejecutarse** — es un force-push sobre rama compartida (Global Constraints). Alternativa sin tocar git: usar el botón "Rollback" al deploy anterior desde el dashboard de Vercel directamente (Vercel mantiene los deploys previos disponibles) — preferible si el usuario tiene el dashboard a mano, porque es más rápido y no depende de este plan.

- [ ] **Step 3: Si el deploy fue exitoso**

Continuar a Task 5.

---

### Task 5: Verificación funcional post-deploy (requiere al usuario)

**Files:** ninguno.

**Interfaces:**
- Consumes: el deploy exitoso confirmado en Task 4.
- Produces: confirmación de que shippear ~10.000 líneas de cambios (Fases A-D completas + el pulido de hoy) de una sola vez no rompió nada visible para el cliente.

- [ ] **Step 1: Conseguir la URL de producción**

Si no está documentada en el repo o en memoria del proyecto, pedírsela al usuario directamente.

- [ ] **Step 2: Navegar las pantallas existentes**

Pedirle al usuario (o, si el agente tiene navegador disponible en ese momento, hacerlo directamente) que confirme que Compras, Ventas y Resultados siguen funcionando igual que antes del deploy — mismos números, sin errores visibles.

- [ ] **Step 3: Confirmar que la UI de Apertura de Gastos aparece**

Esto es esperado y ya decidido (spec sección 3) — no es un problema si aparece, es parte del plan. Solo confirmar que el modal abre sin errores (no hace falta crear ninguna regla real acá, eso es una decisión de negocio aparte de Diego).

---

### Task 6: Documentar el seguimiento pendiente

**Files:** ninguno (memoria del proyecto, fuera del repo).

**Interfaces:** N/A.

- [ ] **Step 1: Anotar en memoria de proyecto**

Registrar que la confirmación final de "se cortó la generación de duplicados" depende de la próxima reimportación real de compras que haga el cliente — no es algo verificable hoy mismo. Anotar también que la limpieza de los 4.585 grupos de compras ya duplicados en producción queda como sub-proyecto separado, pendiente de su propio brainstorming.

- [ ] **Step 2: Cerrar el plan**

Confirmar con el usuario que las 6 tasks quedaron completas y que no hay ninguna acción más pendiente de esta sesión.

---

## Elección de ejecución

Dado que:
- Task 1 → Task 2 → Task 3 son estrictamente secuenciales, cada una depende del resultado exacto de la anterior (no hay nada para paralelizar).
- Tasks 4, 5 y 6 requieren acceso humano a Vercel/producción que ningún subagente tiene — no son delegables.

este plan tiene sentido ejecutarlo **inline**, en esta misma conversación, en vez de vía `subagent-driven-development`. Aun así, la decisión final es del usuario — se ofrecen las dos opciones abajo por consistencia con el proceso.
