# CLAUDE.md — lazarillo-gestion

> Reglas que Claude Code debe respetar en toda solicitud de desarrollo dentro de este repo.

## 0. Contexto del proyecto
- Nombre del proyecto: `lazarillo-gestion`
- Stack: Next.js 16 + React 19 + TypeScript 5 + Tailwind CSS 4 + Prisma 7 (adapter-pg) + Supabase
- Tipo de proyecto: aplicación de gestión (dashboard con persistencia, formularios, import de datos)
- Package manager: npm
- Convenciones de estilo: ESLint 9 (`eslint-config-next`)
- Scripts disponibles: `npm run dev`, `npm run build` (corre `prisma generate` antes del build), `npm run start`, `npm run lint`; `postinstall` corre `prisma generate` automáticamente

## 1. Arquitectura y diseño
- Aplicar **SOLID**, en especial SRP (una función/clase, una responsabilidad) y DIP (depender de abstracciones, no de implementaciones concretas).
- **DRY**, pero sin abstraer antes de la 3ª repetición.
- **KISS**: preferir la solución más simple que resuelva el problema.
- **YAGNI**: no construir flexibilidad para casos hipotéticos no solicitados.
- Separar capas claramente: componentes UI / lógica de negocio (hooks, servicios) / acceso a datos (Prisma, Supabase).
- Bajo acoplamiento, alta cohesión. Composición sobre herencia.
- Ley de Deméter: un módulo solo debe interactuar con sus dependencias directas.
- Toda query a la base de datos pasa por Prisma — no mezclar `pg` directo salvo casos ya justificados en el adapter existente.

## 2. Código y sintaxis
- Nombrado descriptivo y consistente.
- Funciones cortas, un solo nivel de abstracción por función.
- Preferir funciones puras; evitar efectos secundarios ocultos.
- Manejo de errores explícito — nunca silenciar excepciones (`catch {}` vacío prohibido). Dado que este proyecto maneja datos financieros (compras/ventas), ningún error de import/parseo puede fallar en silencio.
- TypeScript en modo estricto; nada de `any` sin justificación en comentario.
- Validar todo dato externo (imports de Excel, respuestas de API) con **Zod** antes de usarlo — no confiar en el tipado de TypeScript solo para datos que entran desde afuera.
- Comentarios que expliquen el "por qué", no el "qué".

## 3. Performance
- Usar TanStack Query para cachear y evitar refetching innecesario; no hacer fetch manual donde ya existe un hook de Query disponible.
- TanStack Table: paginar/virtualizar tablas grandes en vez de renderizar todo el dataset.
- Evitar cálculos/renders innecesarios (memoización donde aplique).
- Import de XLSX: procesar en streaming/lotes para archivos grandes, no cargar todo el archivo en memoria de una sola vez si el tamaño lo justifica.

## 4. Testing y calidad
- Priorizar tests sobre la lógica de import/ETL (es la zona de mayor riesgo del proyecto — ya hubo bugs de silent-drop en datos).
- Cubrir casos límite: filas duplicadas, columnas faltantes, formatos de fecha inconsistentes, valores nulos en el Excel importado.
- Tests aislados y determinísticos.
- No dar una tarea por cerrada si rompe tests existentes.

## 5. Seguridad
- Nunca hardcodear credenciales de Supabase/Postgres — usar variables de entorno (`.env`, nunca commiteadas).
- Validar inputs en todos los límites del sistema, especialmente en Server Actions/API routes que reciben datos de formularios (`zod` con `safeParse` en el servidor — ver sección 8, no hay librería de formularios en el stack).
- Sanitizar contra inyección — aunque Prisma parametriza las queries, revisar cualquier uso de `pg` crudo.
- RLS de Supabase **no aplica** con la arquitectura de conexión actual (Prisma directo a Postgres + `SUPABASE_SERVICE_ROLE_KEY`, que bypassa RLS por diseño) — ver `SECURITY.md`. La autorización es 100% de aplicación vía `requireAuth`/`requireAuthUser`, sin excepciones en ningún route handler nuevo que toque datos de negocio.
- Revisar que `@supabase/ssr` maneje la sesión de forma segura (cookies httpOnly, no exponer tokens en el cliente).

## 6. Mantenibilidad y consistencia
- Conventional Commits (`feat:`, `fix:`, `refactor:`, `docs:`...).
- Cualquier cambio de schema pasa por una migración de Prisma — nunca modificar la base directamente.
- Mantener el README y el schema de Prisma como fuente de verdad documentada del modelo de datos.
- Respetar el estilo ya existente en el repo.
- Correr linter antes de considerar terminada una tarea.

## 7. Reglas específicas para el agente
- **Explicar el plan antes de tocar código** en cambios grandes, y especialmente antes de cualquier migración de Prisma o cambio de schema.
- **No modificar ni borrar código fuera del alcance** de la solicitud.
- Preferir **diffs pequeños e incrementales**.
- Correr `npm run lint` y build después de cambios relevantes.
- No agregar dependencias nuevas sin preguntar primero (especialmente librerías de UI, dado que ya hay shadcn/radix-ui cubriendo la mayoría de los casos).
- Ante cualquier cambio que toque datos de compras/ventas ya importados, preguntar antes de ejecutar — es información sensible del cliente.
  - **Excepción:** un paso individual dentro de una tarea así NO requiere una confirmación aparte si (a) esa tarea pertenece a un plan que ya pasó por el flujo completo de Superpowers (`brainstorming → writing-plans → review`, sección 9.1) y (b) el usuario ya dio luz verde explícita, en esa sesión, para ejecutar esa tarea de punta a punta. En ese caso alcanza con la confirmación inicial de arranque — no hay que repreguntar paso por paso mientras cada uno termine como el plan lo espera.
  - Esta excepción **no** cubre un paso cuyo resultado sea distinto al esperado por el plan (colisiones, verificación post-migración fallida, exit code ≠ 0, cualquier salida inesperada) — ahí el agente para y avisa igual que si la excepción no existiera. Tampoco cubre ningún cambio que no venga de un plan ya revisado de esta forma, ni relaja la restricción de la sección 9.1 sobre `subagent-driven-development`/`dispatching-parallel-agents` (esos siguen sin poder ejecutar cambios sobre compras/ventas de forma autónoma, sin excepción) — aplica solo a ejecución llevada directamente por el agente en conversación con el usuario, con el usuario presente en la sesión.
- **Todo feature nuevo o cambio de arquitectura pasa obligatoriamente por el flujo
  de Superpowers** (`brainstorming → writing-plans → executing-plans → review`,
  ver sección 9.1). No saltarse directo a código ni improvisar un plan propio
  aunque el requerimiento parezca simple a primera vista — el gate de spec/plan
  es el que evita rework en este proyecto.

## 8. Stack y librerías permitidas

**Producción**
- Framework: `next` (^16.2.6), `react` / `react-dom` (19.2.4)
- Datos: `@prisma/client` + `@prisma/adapter-pg` (^7.8.0), `pg`, `@supabase/supabase-js`, `@supabase/ssr`
- Estado y datos remotos: `@tanstack/react-query`, `zustand`
- Validación: `zod` (schemas de ETL, query params y body de API routes)
- UI: `radix-ui`, `shadcn`, `lucide-react`, `cmdk`, `vaul`, `sonner`, `class-variance-authority`, `clsx`, `tailwind-merge`, `tw-animate-css`, `next-themes`
- Animaciones: `framer-motion`
- Utilidades: `date-fns`, `xlsx` (import de datos)
- PWA: `@ducanh2912/next-pwa`

**Desarrollo**
- `typescript`, `@types/node`, `@types/react`, `@types/react-dom`, `@types/pg`
- `eslint` + `eslint-config-next`
- `tailwindcss` + `@tailwindcss/postcss`
- `prisma` (CLI), `tsx` (para scripts sueltos en TS)
- `vitest` (tests unitarios — ver sección 4)

**Reglas sobre el stack**
- Usar **zustand** solo para estado de UI/cliente que no vive en el servidor — datos que vienen de la base van por TanStack Query, no duplicar en zustand.
- Toda validación de datos externos (body de API routes, filas de Excel del ETL) pasa por `zod` con `safeParse`, no reinventar validación manual. No hay librería de formularios en el stack (`react-hook-form` se evaluó y se sacó por no usarse) — formularios simples usan `useState` + la misma validación `zod` del lado servidor.
- No usar `@tanstack/react-table` — se evaluó y se sacó del stack por no usarse; las tablas del dashboard usan hooks propios (`use-sort-state`, `use-table-search`). Si se necesita paginación/virtualización real en el futuro, es una decisión aparte, no asumir que ya está disponible.
- Componentes de UI: usar primero lo que ya provee `shadcn`/`radix-ui` antes de crear un componente desde cero o sumar otra librería.
- `xlsx` es la única librería permitida para import/export de Excel — no sumar alternativas (ej. exceljs) sin justificar por qué `xlsx` no alcanza.
- Cambios de schema: siempre vía `prisma migrate`, nunca editando la base a mano ni el schema sin generar la migración correspondiente.

## 9. Skills instalados — flujo de trabajo del agente

Este proyecto tiene instalados globalmente Superpowers, claude-mem y Task Observer.
Las siguientes reglas ajustan su comportamiento por defecto al contexto de este repo
(datos financieros de cliente, proyecto en fase de handoff).

### 9.1 Superpowers
Instalado como skills individuales en `~/.claude/skills/` (no como plugin de
marketplace ni slash commands `/superpowers:*` — el entorno no soporta el
sistema de marketplace). El bootstrap de `using-superpowers` se inyecta
automáticamente al inicio de cada sesión y tras cada compactación de contexto
vía un hook `SessionStart` instalado manualmente en
`~/.claude/hooks/superpowers-session-start` (declarado en
`~/.claude/settings.json`). No depende de que el CLAUDE.md se lo recuerde al
agente — el hook lo fuerza a nivel de sistema. Verificado activo el 14/08/2026.

- **`using-superpowers` se carga solo** al inicio de cada sesión gracias al
  hook. El resto de las skills (`brainstorming`, `writing-plans`, etc.) siguen
  activándose por matching de descripción, coordinado por `using-superpowers`.
- **Todo feature nuevo o cambio de arquitectura pasa obligatoriamente por**:
  `brainstorming` → (spec) → `writing-plans` → `executing-plans` →
  `requesting-code-review` / `receiving-code-review`. No saltar directo a código
  ni improvisar un plan propio aunque el requerimiento parezca simple a primera
  vista — el gate de spec/plan es el que evita rework en este proyecto.
- Único caso donde se puede saltar el flujo completo: fixes triviales de una
  línea (typos, ajustes de estilo) sin impacto en lógica de negocio.
- **`test-driven-development`** es obligatoria para toda la capa de ETL/import
  (sección 4 ya lo pedía; ahora se hace cumplir automáticamente vía skill). Si
  la skill borra código escrito antes del test, dejarlo — no revertir a mano.
- **`systematic-debugging`** se usa ante cualquier bug reportado en producción,
  en especial en ETL/import — no parchear a ciegas sin investigar causa raíz.
- **Excepción explícita**: `subagent-driven-development` y
  `dispatching-parallel-agents` NO deben ejecutar cambios automáticamente sobre
  datos de compras/ventas ya importados. El plan puede generarse solo, pero la
  ejecución sobre esas rutas se pausa para aprobación manual (sección 7).
- Cualquier migración de Prisma sigue necesitando el plan explicado en texto
  (sección 7) antes de que `writing-plans`/`executing-plans` lo incluyan en un
  plan ejecutable.
- **`verification-before-completion`** se corre antes de dar cualquier tarea
  por cerrada — complementa (no reemplaza) el lint/build ya exigido en sección 7.
- **`finishing-a-development-branch`** y **`using-git-worktrees`** quedan
  disponibles para el cierre de rama, pero su uso en este repo requiere que el
  merge/PR final siga los conventional commits de la sección 6.
- **Nota de mantenimiento**: esta es una instalación manual (snapshot de
  `obra/superpowers`, sin el auto-update que trae el plugin vía marketplace).
  Para actualizar a una versión más nueva hay que repetir el proceso de clonado
  + copia de `skills/` y `hooks/` + re-test del hook en aislamiento — no se
  actualiza solo.

### 9.2 claude-mem
- Memoria habilitada para retener contexto entre sesiones de este repo (decisiones
  de Diego/Juan, bugs ya resueltos como el silent-drop de S7, reglas de negocio
  discutidas en sprints anteriores).
- **No debe** persistir en `claude-mem` valores reales de filas de compras/ventas,
  nombres de clientes finales, ni credenciales — solo contexto técnico/de decisiones
  (qué se decidió, por qué, en qué archivo). Si una observación incluye datos
  sensibles del cliente, el agente debe resumir el *qué se decidió* y omitir los
  valores concretos antes de que se guarde.
- Al iniciar sesión, usar `mem-recall`/contexto cargado automáticamente para no
  repetir preguntas ya resueltas (ej. la regla de prorrateo pendiente con Diego,
  el criterio de vista guardada global vs. por punto de venta).

### 9.3 Task Observer
- Corre en segundo plano en toda tarea multi-paso; loguea correcciones repetidas
  (ej. si me corrigen seguido el mismo patrón de validación Zod o el mismo criterio
  de import) para proponer un skill propio del proyecto más adelante.
- Las observaciones quedan en `skill-observations/` — no requieren aprobación para
  loguearse, pero **sí** la requieren antes de convertirse en un skill nuevo
  instalado (no instalar nada nuevo sin preguntar, ver sección 7).

### 9.4 Orden de precedencia
Si algo en el comportamiento por defecto de estos skills entra en conflicto con
las reglas de este `CLAUDE.md` (especialmente secciones 5, 7 y 8 — seguridad,
alcance del agente, y stack permitido), **este archivo tiene prioridad**. Los
skills aceleran el proceso, no reemplazan las reglas del proyecto.

---
*Archivo vivo — actualizarlo a medida que el proyecto evoluciona.*