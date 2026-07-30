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

---
*Archivo vivo — actualizarlo a medida que el proyecto evoluciona.*
