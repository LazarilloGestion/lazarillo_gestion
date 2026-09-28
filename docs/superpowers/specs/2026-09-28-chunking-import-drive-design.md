# Particionar archivos grandes en el import de Drive — Diseño

**Fecha:** 2026-09-28
**Relacionado:** commit `7eb692a` (fix de archivos no soportados, mismo día — mismo endpoint)

## 1. Problema

El cliente reporta "error de conexión" en la UI al importar la carpeta de Ramos Mejía
(`Ramos - BAR Resto`, `Ramos - FC Canchas`), cada una con 36 archivos tras sumar años
homologados (2016-2026) los días 27/28-sep-2026.

## 2. Causa raíz (investigada con systematic-debugging)

- `hooks/use-drive-import.ts` (`importAllFiles`) manda **todos** los archivos de una
  carpeta en un único `POST /api/etl/drive-import`.
- Esa ruta corre en una función serverless de Vercel con
  `export const maxDuration = 60` (`app/api/etl/drive-import/route.ts:52`).
- Confirmado con el usuario: **"Vercel Runtime Timeout Error: Task timed out after
  60 seconds"**.
- Evidencia de que el import en sí funciona y el cuello de botella es el tamaño del
  batch, no un bug de datos: se investigó un timeout previo del mismo día en San
  Justo (`batchId 89eacae6`, 5 archivos) — **todos** los `ImportLog` quedaron en
  `estado='ok'` en la base; la respuesta HTTP simplemente no llegó a tiempo. San
  Justo nunca volvió a fallar porque su carpeta tiene solo 6 archivos (screenshot del
  usuario, "Importar 6"), contra los 36 de cada carpeta de Ramos Mejía ("Importar 36").
  El timing coincide exacto con cuándo el cliente sumó los archivos homologados de
  años anteriores a Ramos Mejía — no con ningún cambio de código de este proyecto.
- Se descartó como causa la cantidad de Reglas de Apertura activas (112, todas de
  Ramos Mejía) — el usuario confirmó que el origen de una regla sí debe restringir
  qué compras toca (`lib/apertura/motor.ts:233-238`, spec sección 4.1 de una feature
  anterior), y que "transversal" se refería a los **destinos** de una regla (que sí
  pueden cruzar locales), no a su origen. No se tocan reglas en este fix.

## 3. Alcance confirmado con el usuario

- Tamaño de tanda: **5 archivos por request** (default conservador — el batch de
  San Justo con 5 archivos, incluyendo un ventas de 12.725 filas, ya usaba ~35s solo
  en el loop de procesamiento).
- `linkDetalleCompras` + `sincronizarAperturaSiCorresponde` corren **una vez por
  tanda** (no acumulados hasta el final de la carpeta) — ambos ya son idempotentes y
  operan sobre todo el `local` en la base (no sobre "los archivos de este request"),
  así que repetirlos más seguido es seguro, no requiere plomería nueva.
- Si una tanda falla (excepción real de `runETL`, o error de red), se frena el resto
  de la carpeta — mismo comportamiento que existe hoy (un archivo roto bloquea a los
  que le siguen), solo que la unidad de bloqueo pasa de "toda la carpeta" a "la tanda
  de 5".
- La UI debe reflejar progreso incremental tanda por tanda (ej. "12/36 importados").

## 4. Diseño

### 4.1 Sin cambios en el servidor

`POST /api/etl/drive-import` no cambia. Ya procesa `files[]` de cualquier tamaño
en orden de dependencia y corre `linkDetalleCompras`/`sincronizarAperturaSiCorresponde`
una vez al final de cada request — exactamente el comportamiento que se quiere por
tanda. Correr esa sincronización varias veces en vez de una es seguro porque:

- `linkDetalleComprasByComprobante` (`lib/etl/normalizer-utils.ts:19`) hace un
  `UPDATE ... WHERE dc."localId" = ${localId} AND c."localId" = ${localId}` — cubre
  todo el local en la base, no depende de qué tanda trajo cada archivo. Si
  `detalleCompras` de una tanda llega antes que su `compras` correspondiente (en
  otra tanda posterior), simplemente no linkea todavía — la tanda que sí trae ese
  `compras` lo resuelve al correr su propio `linkDetalleCompras` al final.
- `sincronizarAperturaSiCorresponde`/`reaplicarReglasActivas` operan sobre
  `esDistribuido = false` en toda la tabla `compras`, mismo razonamiento.

### 4.2 Todo el cambio va en `hooks/use-drive-import.ts`

`importFiles(files, localId, puntoDeVentaId)` pasa de hacer un solo `fetch` a
particionar `files` en tandas de `CHUNK_SIZE = 5` y iterar sobre ellas
secuencialmente, reusando `parseImportResponse` (ya extraída hoy) para cada tanda:

- Antes de la primera tanda: se marca `"importing"` a todos los archivos, igual que
  hoy.
- Por cada tanda, en orden:
  - Si una tanda anterior ya falló (`aborted = true`), esta tanda ni se intenta —
    se marca `"error"` con un mensaje equivalente al que ya existe hoy para "el resto
    del lote falló antes", y se sigue a la siguiente (para que TODAS las tandas
    restantes queden marcadas, no solo la próxima).
  - Si no, se hace el `fetch` de esa tanda, se parsea con `parseImportResponse`, y
    se actualiza el estado (`setFileStatuses`/`setFileReports`/`setFileErrors`) de
    inmediato — esto es lo que da el progreso incremental en la UI sin tocar
    `drive-folder.tsx`: como el render ya es por archivo individual, cada tanda que
    termina revela sus 5 archivos en la lista existente.
  - Si la tanda falló (excepción real — `res.ok === false` o el `fetch` tira), se
    marca `aborted = true` para las tandas siguientes.
- Los contadores (`errors`, `unsupported`, `records`) se acumulan a través de todas
  las tandas y se devuelven al final, igual forma que hoy — nada cambia para los
  callers (`importOneFile`, `importAllFiles`, `importarTodo`, el botón "Importar N"
  de `DriveFolder`): todos siguen llamando a `importFiles` exactamente igual, la
  partición es un detalle interno.

### 4.3 UI — progreso "X/N importados"

`app/(shell)/importar/drive-folder.tsx` ya recibe `files` y `fileStatuses` como
props. Se agrega un contador junto al spinner de la carpeta mientras
`folderImporting || batchRunning`:

```
{importedCount}/{files.length} importados
```

donde `importedCount` cuenta archivos en estado `"success"` o `"unsupported"`
(terminales, igual criterio que ya usa `allDone`). No hace falta ningún estado
nuevo ni prop nueva — se deriva de lo que el componente ya tiene.

### 4.4 Error handling

Sin cambios de fondo respecto a hoy — se reusa el mismo patrón de mensajes
("No se llegó a procesar: ... falló antes") que ya existe para el caso de una
sola tanda, ahora aplicado también entre tandas de la misma carpeta.

## 5. Testing

- `hooks/parse-import-response.ts` no cambia (se sigue llamando una vez por tanda,
  con la tanda en vez de la carpeta completa como `files`) — sus tests existentes
  siguen cubriendo ese contrato sin modificación.
- Nuevo: tests para la función de partición (`chunkFiles` o equivalente) — casos
  límite: 0 archivos, menos de `CHUNK_SIZE`, exactamente `CHUNK_SIZE`, más de una
  tanda con resto no exacto (ej. 36 → 8 tandas, última de 1).
- La lógica de "tanda falla → se frena el resto" vive en `importFiles`, que depende
  de `useState`/React — igual que hoy, este archivo no tiene tests unitarios directos
  (no hay `jsdom`/`testing-library` en el stack); se verifica con `tsc`+`lint`+build,
  y con una pasada manual en el navegador contra una carpeta real de más de 5
  archivos antes de dar la tarea por cerrada.

## 6. Riesgo residual (fuera de alcance de este fix)

Si en el futuro una sola tanda de 5 archivos (ej. 5 archivos de ventas muy grandes)
por sí sola superara los 60s, este fix no alcanza — pero no hay evidencia hoy de que
eso ocurra (el peor caso medido, ventas de San Justo con 12.725 filas, tomó 17s). Se
deja documentado para revisar si aparece evidencia real, en vez de sobre-diseñar
ahora (mismo criterio YAGNI de otras partes de este módulo).

La revisión final de rama detectó dos límites conocidos adicionales, aceptados
explícitamente (no requieren cambio de código):

- **Rate limit por usuario** (`rateLimit(user.id, 20, 60_000)` en
  `app/api/etl/drive-import/route.ts`): con una tanda = un request, una carpeta grande
  ahora genera más requests que antes (ej. 36 archivos → 8 tandas en vez de 1). A la
  velocidad medida hoy (una tanda de 5 archivos tarda varios segundos), no hay riesgo
  real de pegarle a las 20 requests/60s — pero si `importarTodo` llegara a mandar
  varias carpetas grandes muy rápido, podría acercarse al límite. Sin evidencia de que
  esto pase hoy; no se ataca sin evidencia real (YAGNI).
- **Validación previa por tanda, no por carpeta entera:** el comentario "evita commits
  parciales" en `route.ts` (loop de validación de tamaño/magic-bytes/local requerido)
  ahora vale solo dentro de una tanda, no de la carpeta completa — un archivo inválido
  en la tanda 3 ya no impide que las tandas 1 y 2 hayan commiteado. Aceptado por
  diseño: los upserts del ETL son idempotentes, y esto es consistente con el resto de
  la sección 4 (cada tanda es su propia unidad de trabajo).

## 7. Exención de Maestros (agregado tras revisión final de rama)

La partición en tandas del punto 4.2 **no aplica a la carpeta de Maestros** — solo a
carpetas transaccionales (las que se importan con un `localId` conocido). Maestros
siempre se manda en un único request, igual que antes de este fix.

Motivo: el servidor ordena por dependencia real (`getFileOrder`, headers del Excel)
solo *dentro* de un mismo request — nunca entre requests separados. La carpeta de
Maestros típicamente tiene 6 tipos de archivo (ya supera `CHUNK_SIZE = 5`), y el
orden entre tandas dependería de un sort client-side por prefijo numérico del nombre
de archivo (`app/api/drive/files/route.ts`, función `depOrder`) que no garantiza
dependencias — un archivo no soportado (ver fix de "archivos no soportados", mismo
día) con un prefijo numérico bajo podría correr `conceptosCaja` antes que
`rubrosConceptoCaja` hubiera commiteado. Eso dispara un silent-drop real:
`lib/etl/normalizers/conceptos-caja.ts` pone `codRga = null` en silencio (no error)
para un código que todavía no existe en la base, siempre que la base ya tenga *algún*
`rubroConceptoCaja` (o sea, en cualquier import que no sea el primerísimo de la
historia).

Maestros nunca fue la causa del timeout original — es un conjunto chico y fijo de
tipos de archivo (a diferencia de las carpetas transaccionales, que acumulan años de
compras/ventas sin techo, como pasó en Ramos Mejía). No necesita particionarse.
