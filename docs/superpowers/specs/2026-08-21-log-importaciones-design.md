# Log centralizado del proceso de importación

> Spec arquitectónica. Ver `docs/superpowers/plans/` para el plan ejecutable derivado de esta spec.

## 1. Problema

Hoy no existe ningún registro persistente de qué pasó en cada corrida de import de compras/ventas/maestros. Cuando el cliente reportó compras duplicadas en producción (21-ago-2026, ver `project_fix_duplicados_main_dev.md`), la única forma de diagnosticarlo fue investigar directo contra la base con queries de solo lectura — no hubo ningún log al que recurrir para ver, corrida por corrida, cuántas filas se insertaron vs. se actualizaron. Un log de import hubiera hecho ese bug visible de inmediato (un salto anómalo en `created` en vez de `updated` en una reimportación).

`lib/etl/run-etl.ts` ya devuelve un `ETLReport` completo por archivo procesado (`fileType`, `totalRows`, `created`, `updated`, `skipped`, `skippedRows`, `errors`, `comprasDistribuidasModificadas`, `durationMs`, `storagePath`) — ese resultado se arma y se usa dentro de `POST /api/etl/drive-import` (único entry point de import del proyecto) pero nunca se persiste; solo viaja en la respuesta HTTP de esa request.

## 2. Alcance

Persistir cada corrida de import (una fila por archivo procesado, exitoso o fallido) en una tabla nueva de Postgres, consultable con SQL directo.

**Explícitamente fuera de alcance de este v1** (YAGNI, ver sección 3):
- El resultado de `sincronizarTrasImport` (sync de Apertura de Gastos post-batch) — ya tiene su propio `console.error`, y no es el riesgo que motivó esta feature.
- Pantalla nueva en el dashboard para visualizar el historial — se consulta con SQL directo por ahora.
- Job de limpieza/retención — Postgres no tiene el límite artificial que sí tienen los servicios externos evaluados (Sentry, Better Stack), no hace falta acotar retención.

## 3. Decisiones tomadas con el usuario

- **Tabla en Prisma, no servicio externo**: se evaluaron Sentry (free: 5k eventos/mes, retención 30 días, pago desde $26/mes) y Better Stack/Logtail (free: 1GB, retención 3 días, pago desde $24/mes) — ambos con retención acotada en el free tier. Una tabla propia usa la misma base que ya se paga, sin límite de retención ni dependencia nueva.
- **Escritura en la ruta (`route.ts`), no dentro de `runETL`**: mantiene `runETL` puro/testeable sin acoplarlo a la tabla de auditoría; la ruta ya orquesta pasos de post-procesamiento del mismo tipo (`linkDetalleCompras`, `sincronizarAperturaSiCorresponde`) — sumar la persistencia del log ahí sigue el mismo patrón ya establecido.
- **Una fila por archivo procesado**, no una fila por POST completo — mismo shape que ya devuelve `runETL`, sin transformar ni aplanar nada. Un `batchId` (uuid) generado una vez por POST correlaciona los archivos de una misma corrida cuando haga falta.
- **Errores y filas omitidas completos, como JSON** (no solo el conteo) — es justo el detalle que hubiera hecho falta para diagnosticar el bug de duplicados sin queries ad-hoc contra la base.
- **Los fallos totales también se loguean**: si `runETL` tira una excepción a mitad de un archivo (no llega a generar `ETLReport`), se guarda una fila con `estado: 'error'` y el mensaje de la excepción — sin esto, el caso más grave (un import que revienta) queda invisible en el log.

## 4. Diseño

### 4.1 Modelo Prisma (migración nueva)

```prisma
model ImportLog {
  id      Int    @id @default(autoincrement())
  batchId String // uuid, uno por POST — correlaciona los archivos de un mismo import

  fileType    String? // ETLFileType; null si el archivo no llegó a detectarse
  fileName    String
  storagePath String?

  localId        Int?
  puntoDeVentaId Int?

  estado    String // 'ok' | 'error'
  totalRows Int?
  created   Int?
  updated   Int?
  skipped   Int?

  errors       Json?   // ETLRowError[] tal cual los arma runETL
  skippedRows  Json?   // ETLSkippedRow[] tal cual
  errorMessage String? // solo cuando estado='error' (excepción de runETL, no llegó a haber report)

  durationMs Int?

  triggeredBy String // user.id de requireAuthUser()
  creadoEn    DateTime @default(now())

  @@index([batchId])
  @@index([fileType, creadoEn])
  @@map("import_logs")
}
```

`fileType` es `String?` (no el enum `ETLFileType` de TypeScript) porque puede ser `null` en el camino de error cuando `detectFileType` nunca llegó a resolverlo, y porque Prisma no comparte el union type de `lib/etl/types.ts` — se valida en el código de aplicación, no en el schema (mismo criterio ya usado en `ReglaApertura.nivel`/`modo`/`estado`, strings con valores fijos documentados por comentario, sin `enum` de Prisma).

`localId`/`puntoDeVentaId` son `Int?` sueltos (no relaciones FK a `Local`/`PuntoDeVenta`) — un log de auditoría no debe bloquearse ni perder información si el local se borra o cambia más adelante; guarda el id crudo como referencia histórica.

### 4.2 Dónde y cómo escribe (`app/api/etl/drive-import/route.ts`)

- Al principio del `POST`, después de pasar la validación de body: `const batchId = crypto.randomUUID();` (global de Node, sin import nuevo).
- Camino éxito — justo después de `report = await runETL(buffer, storagePath, ctx, getEtlClient() as unknown as DbClient);` (línea 205 actual), antes de `reports.push(report)`:

```ts
try {
  await prisma.importLog.create({
    data: {
      batchId,
      fileType: report.fileType,
      fileName: file_name,
      storagePath: report.storagePath,
      localId,
      puntoDeVentaId,
      estado: "ok",
      totalRows: report.totalRows,
      created: report.created,
      updated: report.updated,
      skipped: report.skipped,
      errors: report.errors,
      skippedRows: report.skippedRows,
      durationMs: report.durationMs,
      triggeredBy: user.id,
    },
  });
} catch (logErr) {
  console.error("[POST /api/etl/drive-import] Falló el registro del ImportLog, se sigue sin loguear", { userId: user.id, file_name }, logErr);
}
```

- Camino error — dentro del `catch` que ya existe (líneas 206-216), antes de armar la respuesta 422:

```ts
try {
  await prisma.importLog.create({
    data: {
      batchId,
      fileType: null,
      fileName: file_name,
      localId,
      puntoDeVentaId,
      estado: "error",
      errorMessage: message,
      triggeredBy: user.id,
    },
  });
} catch (logErr) {
  console.error("[POST /api/etl/drive-import] Falló el registro del ImportLog (camino error), se sigue sin loguear", { userId: user.id, file_name }, logErr);
}
```

- Ambos `create` van en su propio try/catch — un fallo al escribir el log NUNCA debe tirar abajo el import real ni cambiar el status code de la respuesta (mismo criterio "best-effort" que ya usa el archivado a Storage en la misma ruta, líneas 190-198).
- No se necesita agregar `crypto` como import — `globalThis.crypto.randomUUID()` está disponible nativamente en el runtime `nodejs` que ya declara esta ruta (`export const runtime = "nodejs";`, línea 21).

## 5. Seguridad y reversibilidad

- Tabla nueva, sin tocar ni un dato de `compras`/`ventas`/`detalle_compras` existente — cambio aditivo puro.
- `errors`/`skippedRows` como `Json` pueden contener datos derivados de las filas del Excel importado (ej. `rawCodigo`, `concepto`, `importe` de una fila con error) — mismo nivel de sensibilidad que ya tienen `compras`/`ventas` en la base (datos del cliente, no de terceros ni credenciales). No aplica ninguna regla nueva de RLS/autorización: la tabla solo se lee vía SQL directo por ahora, sin exponerse en ninguna API ni ruta de la app.
- Migración de Prisma estándar (`prisma migrate dev` en local, `prisma migrate deploy` en producción vía el flujo ya establecido) — tabla nueva, sin `ALTER` sobre tablas existentes, sin riesgo de pérdida de datos.
- El registro del log es best-effort (try/catch propio) — un fallo ahí nunca debe convertir un import exitoso en un error reportado al usuario, ni viceversa.

## 6. Testing

- No hay lógica pura nueva que testear con tests unitarios aislados (a diferencia de `planCleanupDuplicados` o `computeCompraRowId`) — el `create` de Prisma es I/O directo, y el mapeo de campos de `ETLReport` → `ImportLog` es una asignación 1:1 sin transformación.
- Verificación: `npx tsc --noEmit` (el modelo nuevo debe tipar correctamente contra `prisma.importLog`), `npm run lint`, y una corrida real de import en producción post-deploy para confirmar que aparece la fila esperada en `import_logs` (mismo criterio que otras verificaciones post-deploy de este proyecto — no hay ambiente de test separado).

## 7. Alcance cerrado

Esta spec cubre únicamente la tabla `import_logs` y su escritura desde `POST /api/etl/drive-import`. No cubre: UI de visualización, logging del resultado de `sincronizarTrasImport`, ni ningún cambio a `runETL` o a los normalizers existentes.
