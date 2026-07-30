# AUDIT.md — Escaneo de todo el proyecto contra CLAUDE.md

> Diagnóstico únicamente. Ningún archivo de código fue modificado.
> Generado a partir de una lectura completa de `app/`, `components/`, `lib/`, `hooks/`, `prisma/`.

---

## 1. Arquitectura (Sección 1 de CLAUDE.md)

### 1.1 — Autorización sin distinción de roles (Diego / Juan / cliente)
- **Archivo:** [proxy.ts:6](proxy.ts#L6)
- **Principio violado:** "Separar capas claramente" / Ley de Deméter — la única puerta de acceso a toda la app es un array hardcodeado: `const ALLOWED_EMAILS = ["lazarillogestion@gmail.com"]`. No existe ningún concepto de rol en el código (no hay campo `role` en el modelo de usuario, ni checks diferenciados por handler).
- **Severidad:** alta
- **Sugerencia:** si el proyecto ya distingue Diego/Juan/cliente en la práctica, modelar el rol explícitamente (tabla o claim en Supabase) y centralizar la autorización, en vez de un allowlist de emails en el middleware.

### 1.2 — Raw SQL con cast de tipos innecesario y repetido (bypassa el Prisma Client tipado)
- **Archivos:** [lib/etl/normalizers/compras.ts:136](lib/etl/normalizers/compras.ts#L136), [proveedores.ts:58](lib/etl/normalizers/proveedores.ts#L58), [detalle-compras.ts:118](lib/etl/normalizers/detalle-compras.ts#L118), [subrubros-articulo.ts:48](lib/etl/normalizers/subrubros-articulo.ts#L48), [rubros-articulo.ts:54](lib/etl/normalizers/rubros-articulo.ts#L54), [conceptos-caja.ts:52](lib/etl/normalizers/conceptos-caja.ts#L52), [articulos.ts:47](lib/etl/normalizers/articulos.ts#L47), [rubros-concepto-caja.ts:41](lib/etl/normalizers/rubros-concepto-caja.ts#L41), [ventas.ts:121](lib/etl/normalizers/ventas.ts#L121)
- **Principio violado:** Sección 1 ("Toda query pasa por Prisma... no mezclar implementaciones sin justificar") + Sección 2 (escape hatch de tipos sin comentario que lo justifique) + DRY.
- **Detalle:** las 9 llamadas castean así: `(prisma as unknown as { $executeRaw: (q: Prisma.Sql) => Promise<number> }).$executeRaw(...)`. El cast parece innecesario: [lib/etl/normalizer-utils.ts:20](lib/etl/normalizer-utils.ts#L20) recibe el mismo tipo `DbClient` y llama `prisma.$executeRaw` directo, sin cast, en el mismo archivo/paquete.
- **Severidad:** media
- **Sugerencia:** verificar si el cast es realmente necesario (posible resabio de una versión anterior del tipo `DbClient`); si no lo es, eliminarlo en los 9 lugares. Si lo es, extraer un helper tipado único en vez de repetir el escape hatch.

---

## 2. Código y sintaxis (Sección 2)

### 2.1 — Cero validación con Zod de las filas de Excel importadas (ETL)
- **Archivos:** [lib/etl/types.ts:20](lib/etl/types.ts#L20) (`ETLRow = Record<string, unknown>`), [lib/etl/helpers.ts:12-25](lib/etl/helpers.ts#L12) y todos los normalizers en `lib/etl/normalizers/*.ts`
- **Principio violado:** Sección 2 — "Validar todo dato externo (imports de Excel...) con Zod antes de usarlo — no confiar en el tipado de TypeScript". Ningún normalizer usa `zod`; el único uso de Zod en todo el repo es en `lib/dashboard/schemas.ts` (params de query) y en los `PATCH`/`PUT` de edición manual.
- **Detalle:** cada normalizer valida a mano y de forma parcial (ej. `compras.ts:53` solo chequea que `COD_CGA` y `FECHA` no sean `null`). Valores con formato incorrecto (fecha no parseable, importe no numérico) no generan error: `toDecimalStr`/`safeDate` ([lib/etl/helpers.ts:20-25](lib/etl/helpers.ts#L20), [helpers.ts:45-50](lib/etl/helpers.ts#L45)) los convierten silenciosamente en `null` y la fila se inserta igual, sin pasar por `errors` ni `skippedRows`.
- **Severidad:** **alta** — dado el historial de bugs de import silencioso mencionado, este es el hallazgo de mayor riesgo del audit.
- **Sugerencia:** definir un `z.object(...)` por tipo de archivo (compras, ventas, detalle-compras, etc.), correr `.safeParse` fila por fila, y enrutar los fallos de parseo a `errors`/`skippedRows` en vez de coercionar a `null`.

### 2.2 — Dedup silencioso "last-wins" sobre datos transaccionales
- **Archivos:** [lib/etl/normalizers/compras.ts:64-68](lib/etl/normalizers/compras.ts#L64), [detalle-compras.ts:42](lib/etl/normalizers/detalle-compras.ts#L42), [ventas.ts:60](lib/etl/normalizers/ventas.ts#L60)
- **Principio violado:** Sección 2 — "ningún error de import/parseo puede fallar en silencio".
- **Detalle:** las filas se deduplican por un hash (`rowId = sha256(COD_CGA|FECHA|CODIGO|CONCEPTO|DETALLE|OBSERVAC|IMPORTE)`). Si dos filas genuinamente distintas producen el mismo hash, una se descarta sin registro (el propio comentario en el código lo llama "last-wins, silencioso" y aclara "NO se cuenta en skipped"). El tipo `ETLSkippedRow.motivo` ya tiene un valor `"duplicado"` (`lib/etl/types.ts:38`) que no se usa en este path — es decir, la estructura para reportarlo ya existe pero no está conectada.
- **Severidad:** alta — coincide con el patrón exacto del bug histórico descripto (matching por fecha+descripción que hizo perder un registro de $2.6M).
- **Sugerencia:** conectar estos descartes al `skippedRows` existente con `motivo: "duplicado"` en vez de descartarlos en silencio.

### 2.3 — `catch {}` vacío sin comentario que lo justifique
- **Archivo:** [lib/supabase/server.ts:21](lib/supabase/server.ts#L21)
- **Principio violado:** Sección 2 — "catch {} vacío prohibido".
- **Detalle:** es el patrón oficial de Supabase SSR para Next.js (el `set` de cookies falla si se llama desde un Server Component sin acción/route asociada, y no es un problema porque el middleware refresca la sesión aparte) — pero tal cual está escrito, viola la letra de la regla y no tiene comentario que explique por qué es intencional.
- **Severidad:** baja
- **Sugerencia:** agregar un comentario de una línea explicando por qué el catch está vacío, en vez de tocar el patrón (que es correcto).

### 2.4 — Error de red silenciado sin logging
- **Archivo:** [app/(shell)/importar/page.tsx:230](app/(shell)/importar/page.tsx#L230)
- **Principio violado:** Sección 2 — manejo de errores explícito.
- **Detalle:** `.catch(() => {})` tras refrescar `/api/etl/maestros-status` post-import. Es un refresco no crítico, pero no queda ningún rastro si falla.
- **Severidad:** baja

---

## 3. Performance (Sección 3)

### 3.1 — Import de Excel sin streaming/lotes
- **Archivo:** [lib/etl/helpers.ts:88-99](lib/etl/helpers.ts#L88) (`readExcelBuffer`)
- **Principio violado:** Sección 3 — "Import de XLSX: procesar en streaming/lotes para archivos grandes, no cargar todo el archivo en memoria de una sola vez si el tamaño lo justifica."
- **Detalle:** `XLSX.read(buffer)` + `sheet_to_json` cargan el archivo entero en memoria de un saque. Hay un cap de 10 MB por archivo en [app/api/etl/drive-import/route.ts:22](app/api/etl/drive-import/route.ts#L22), lo que acota el impacto real, pero el patrón en sí no sigue la regla.
- **Severidad:** media (mitigada parcialmente por el límite de tamaño existente)

### 3.2 — `@tanstack/react-table` declarado pero no usado; tablas de detalle sin virtualización
- **Archivos:** [components/dashboard/detalle-modal-shell.tsx:111](components/dashboard/detalle-modal-shell.tsx#L111), `pivot-table.tsx`, `resultados-pivot-table.tsx`, `ventas-pivot-table.tsx`
- **Principio violado:** Sección 3 — "TanStack Table: paginar/virtualizar tablas grandes en vez de renderizar todo el dataset."
- **Detalle:** `@tanstack/react-table` está en `package.json` pero no aparece en ningún import del repo (verificado por grep). Todas las tablas están armadas a mano (`use-sort-state.ts`, `use-table-search.ts`) y `DetalleModalShell` renderiza `filtered.map(renderRow)` sin paginar ni virtualizar. Los endpoints de detalle devuelven hasta 2000 filas ([app/api/dashboard/detalle/route.ts:149](app/api/dashboard/detalle/route.ts#L149), [detalle-ventas/route.ts:66](app/api/dashboard/detalle-ventas/route.ts#L66)), que hoy se montan enteras en el DOM.
- **Severidad:** media
- **Sugerencia:** adoptar `@tanstack/react-table` (ya aprobado en el stack) con paginación real, o quitarlo de `package.json` si se decide mantener la tabla manual.

---

## 4. Testing y calidad (Sección 4)

### 4.1 — No existe ningún test en el proyecto
- **Archivos:** todo el repo — no hay `*.test.ts`, `*.spec.ts`, ni configuración de Vitest/Jest, ni script `test` en `package.json`.
- **Principio violado:** Sección 4 completa — "Priorizar tests sobre la lógica de import/ETL (zona de mayor riesgo... ya hubo bugs de silent-drop)", cubrir duplicados/columnas faltantes/fechas inconsistentes/nulls.
- **Severidad:** **alta** — es la zona que el propio CLAUDE.md marca como la de mayor riesgo del proyecto, y tiene cobertura cero. Combinado con 2.1 y 2.2, no hay ninguna red de seguridad automatizada para el path de import.
- **Sugerencia:** priorizar tests de los normalizers (`lib/etl/normalizers/*`) con foco en: filas duplicadas con datos casi-idénticos, columnas faltantes, fechas inconsistentes, `IMPORTE` no numérico.

---

## 5. Seguridad (Sección 5)

### 5.1 — RLS de Supabase inexistente y estructuralmente inaplicable
- **Archivos:** [lib/prisma.ts](lib/prisma.ts) (conexión directa a Postgres vía `@prisma/adapter-pg`, nunca pasa por PostgREST), [lib/supabase/admin.ts](lib/supabase/admin.ts) (usa `SUPABASE_SERVICE_ROLE_KEY`, que por diseño de Supabase bypassa cualquier RLS), sin `CREATE POLICY` en ninguna migración de `prisma/migrations/`.
- **Principio violado:** Sección 5 — "Principio de menor privilegio en las políticas RLS de Supabase."
- **Detalle:** las tablas de negocio (compras, ventas, proveedores, etc.) viven en Postgres y se acceden **solo** vía Prisma con connection string directo — RLS no aplicaría aunque existiera. Las tablas propias de Supabase (`user_drive_config`) también se leen/escriben siempre con el cliente admin (service role), que bypassa RLS igual. Es decir: toda la autorización de datos depende 100% del código de aplicación (`requireAuth`/`requireAuthUser` + el allowlist de un email en `proxy.ts`), sin ninguna capa de defensa adicional a nivel de base de datos.
- **Severidad:** alta
- **Sugerencia:** si se quiere RLS real como defensa en profundidad, las queries de negocio tendrían que pasar por un cliente Supabase con el JWT del usuario (no Prisma directo ni service role) para al menos una porción de las operaciones sensibles; alternativa más realista dado el uso de Prisma: documentar explícitamente que la autorización es 100% de aplicación y reforzar tests/revisión de código en `requireAuth`/`requireAuthUser` como mitigación, ya que RLS no es aplicable con esta arquitectura de conexión.

### 5.2 — Validación manual (no-Zod) en endpoints fuera del ETL
- **Archivos:** [app/api/drive/config/route.ts:38-48](app/api/drive/config/route.ts#L38) (`extractFolderId` con regex), [app/api/etl/drive-import/route.ts:58-79](app/api/etl/drive-import/route.ts#L58)
- **Principio violado:** Sección 2/5 — validar con Zod en los límites del sistema. (Nota: la mayoría de los demás endpoints —`rubros-dashboard`, `compras/[rowId]`, `resultados-vistas`, `ventas/[rowId]`, `flujo-caja`— **sí** usan `zod` + `safeParse` correctamente; estos dos son la excepción.)
- **Severidad:** baja — la validación manual existente cubre los casos, pero es inconsistente con el resto del proyecto.

---

## 6. Mantenibilidad (Sección 6)

Sin hallazgos relevantes — historial de commits sigue Conventional Commits, migraciones de Prisma están al día con el schema (ver sección 7).

---

## 7. Migraciones de Prisma (foco #5 del pedido)

Sin hallazgos: `git status` sobre `prisma/` está limpio y la migración más reciente (`20260727120000_resultados_vistas_conceptos_visibles`) es consistente con el `schema.prisma` actual (columna `conceptosVisibles` presente en ambos). No se detectó drift de schema sin migración generada.

---

## 8. Stack y librerías permitidas (Sección 8)

### 8.1 — `react-hook-form` y `@hookform/resolvers` declarados pero no usados
- **Archivos:** `package.json` (dependencias), único formulario real del repo: [app/(shell)/importar/page.tsx:346-364](app/(shell)/importar/page.tsx#L346) (`saveConfig`, con `<form onSubmit>` + `useState` manual, sin `react-hook-form` ni validación Zod del input).
- **Principio violado:** Sección 8 — "Toda validación de formularios pasa por zod + @hookform/resolvers, no reinventar validación manual."
- **Severidad:** media (bajo impacto funcional — es un solo input de texto — pero es el único formulario del proyecto y no sigue el patrón que el propio CLAUDE.md fija como obligatorio).
- **Sugerencia:** migrar `saveConfig` a `useForm` + `zodResolver`, o si el proyecto decide que no ameritan react-hook-form los formularios tan simples que tiene, quitar la dependencia y ajustar la regla en CLAUDE.md.

### 8.2 — `SearchInput` reinventa `Input` en vez de componerlo
- **Archivo:** [components/ui/search-input.tsx:12-15](components/ui/search-input.tsx#L12)
- **Principio violado:** Sección 8 — "usar primero lo que ya provee shadcn/radix-ui antes de crear un componente desde cero."
- **Detalle:** en vez de reusar `<Input>` ([components/ui/input.tsx](components/ui/input.tsx), que usa tokens de tema `border-input`/`bg-input/30` coherentes con el dark mode vía `next-themes`), `SearchInput` arma su propio contenedor con colores hardcodeados (`border-zinc-200 dark:border-zinc-700`, `bg-white dark:bg-zinc-800`, etc.).
- **Severidad:** media — funciona, pero duplica estilos y es más frágil ante cambios de tema (no usa las variables de diseño del sistema).
- **Sugerencia:** reconstruir `SearchInput` componiendo `<Input>` + iconos, en vez de un `<div>` con bordes propios.

### 8.3 — `@tanstack/react-table` sin usar
Ver hallazgo 3.2 (mismo hallazgo, impacta stack y performance).

---

## Resumen por severidad

| Severidad | Cantidad | Hallazgos |
|---|---|---|
| Alta | 5 | 2.1, 2.2, 4.1, 5.1, (1.1 relacionada) |
| Media | 6 | 1.2, 3.1, 3.2, 8.1, 8.2, 5.2 (borde bajo/media) |
| Baja | 3 | 2.3, 2.4, 5.2 |

**Los tres hallazgos más urgentes** (todos tocan el punto que el cliente ya sufrió — pérdida silenciosa de datos en import): 2.1 (sin Zod en filas de Excel), 2.2 (dedup last-wins silencioso en compras/ventas/detalle-compras) y 4.1 (cero tests sobre esa misma lógica). Los tres se refuerzan entre sí: sin schema de validación ni tests, un caso de colisión de hash como el del punto 2.2 no tiene ninguna capa que lo detecte antes de producción.
