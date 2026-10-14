# Identidad de líneas de `detalle_compras`: no perder líneas repetidas ni pisar proveedores

> Spec arquitectónica (cambio de identidad en el ETL + reimportación de datos ya importados). Sale de la investigación del 14-oct-2026 sobre los comprobantes donde el detalle no cuadra con Compras (ver memoria `project_detalle_compras_rowid_colisiones`). **La ejecución contra producción requiere OK explícito del usuario (CLAUDE.md §7).**

## 1. Problema

`makeRowId` en `lib/etl/normalizers/detalle-compras.ts` arma la identidad de cada línea con `COD_CPB|NUMERO1|NUMERO2|CODIGO|CANTIDAD|NETO`. El ERP no exporta número de línea. Dos filas del archivo con el mismo hash se toman como duplicado: la dedup del archivo se queda con la última y el upsert `ON CONFLICT ("rowId") DO UPDATE` pisa lo que ya estaba guardado.

Mecanismos confirmados contra los archivos originales del ERP (bucket `uploads`, solo lectura):

1. **Líneas repetidas idénticas en una misma factura.** Mismo artículo, cantidad y precio en dos líneas (por ejemplo, dos barriles iguales). Se guarda una sola. Caso verificado: Z 0935-18022022 trae 10 líneas en el ERP que suman $27.400, igual que Compras; quedaron guardadas 7 ($20.000). Explica unos 109 de los 126 grupos (comprobante + local + proveedor) donde Compras supera al detalle. En `import_logs` (desde el 24-ago) hay 402 líneas descartadas como "duplicado" del mismo proveedor.
2. **Tickets de distintos proveedores con el mismo número.** El hash no incluye `COD_PRO`, así que una línea igual en el ticket de otro proveedor pisa a la primera. Caso verificado: Z 0001-00000001, proveedor 194 (enero 2019): la línea de $300 quedó guardada como del proveedor 256 (octubre 2019). Hay 821 comprobantes que comparten número entre proveedores.
3. **Entre locales (riesgo, no verificado).** El hash tampoco incluye el local. Como el upsert hace `"localId" = COALESCE(existente, nuevo)`, una colisión entre locales dejaría la línea en el primer local con los datos del segundo.
4. **El vínculo `compraId` ignora el proveedor.** `linkDetalleComprasByComprobante` une por `comprobante` + `localId`, así que una línea puede quedar vinculada a la compra de otro proveedor con el mismo número.

**Impacto:** `detalle_compras` solo la leen el modal de comprobante (`/api/dashboard/compra-lineas`) y el ETL. Los totales del panel salen de `compras` y no se ven afectados. El modal ya filtra por proveedor desde el 14-oct (`932747b`), pero sigue mostrando facturas incompletas por (1) y (2).

**Fuera de alcance:**
- Los 96 comprobantes donde el archivo de Compras del ERP no trae una línea que sí está en el detalle. Vienen así del ERP; la lista quedó en el doc para el cliente.
- Las líneas que el ERP borra de una factura ya importada (el `notIn` de archivo completo sigue pendiente, como en compras).
- La identidad de `compras`.

## 2. Diseño

### 2.1 Identidad nueva

```
rowId = sha256( localId | COD_PRO | COD_CPB | NUMERO1 | NUMERO2 | CODIGO | CANTIDAD | NETO | ocurrencia )[0..24]
```

- `ocurrencia` = índice (desde 0) de esa misma tupla dentro del archivo, en orden de aparición. Las líneas idénticas son intercambiables, así que el índice es estable entre reimportaciones del mismo archivo aunque cambie su orden relativo.
- `localId` sale de `ctx.localId`; si es null, se usa `""`, igual que hoy con los campos vacíos. No se incluye el punto de venta: `detalle_compras` no lo guarda, y si los archivos de Bar y Canchas traen la misma factura, tiene que seguir siendo una sola línea por local.
- Con esta clave desaparece la dedup dentro del archivo: no puede haber dos filas con el mismo hash, porque la ocurrencia las diferencia. El motivo `"duplicado"` deja de usarse en detalle. El tipo `ETLSkippedRow` se mantiene, porque `sin_datos` sigue existiendo.
- La función pasa a ser pura y exportada (`detalleCompraRowIds(rows, localId) → string[]`) para testearla aislada.

### 2.2 Vínculo con compras

`linkDetalleComprasByComprobante` agrega `AND dc."codPro" = c.codigo`, el mismo criterio que el modal (`whereLineasDeCompra`).

### 2.3 Reimportación (datos ya importados)

Nada referencia `detalle_compras."rowId"`: no hay FK entrante. Hay archivos de detalle guardados para todos los años y puntos de venta con datos (local 1: 2016–2026, Bar y Canchas; local 2: 2025–2026).

Script `scripts/reimportar-detalle-compras.ts`, con `--dry-run` por defecto y `--apply`:

1. Para cada local y punto de venta, toma el último archivo `detalleCompras` con estado `ok` de cada `fileName` en `import_logs` y lo baja del bucket.
2. Corre `normalizeDetalleCompras` con la identidad nueva, que inserta las filas con los `rowId` nuevos.
3. Borra las filas del local cuyo `rowId` no esté en el conjunto recién importado de ese local.
4. Corre `linkDetalleCompras` por local.

**Dry-run (obligatorio antes de `--apply`):** filas a insertar, filas a borrar y filas a borrar cuyo `comprobante` no aparece en ningún archivo reimportado. Este último número tiene que ser 0; si no lo es, se para y se revisa (sería historia sin archivo guardado).

**Orden insertar → borrar** (y no borrar → insertar): si el script se corta a mitad, la tabla nunca queda vacía. Lo peor que puede pasar es que el modal muestre líneas duplicadas hasta volver a correrlo, y el script es idempotente.

**Verificación post (queries de solo lectura, comparando antes y después):**
- Grupos (comprobante + local + proveedor) donde Σ detalle ≠ Σ compras: baja de 222 a unos 96 (los del ERP) más un residuo chico.
- Z 0935-18022022 tiene 10 líneas y suma $27.400.
- Z 0001-00000001 del proveedor 194 tiene sus 4 líneas.
- Total de filas de `detalle_compras` ≥ antes.

### 2.4 Tests (TDD, capa ETL — CLAUDE.md §4)

- Dos líneas idénticas en la misma factura generan 2 rowIds distintos, y se guardan las dos.
- La misma línea en tickets de dos proveedores con el mismo número genera rowIds distintos.
- La misma línea en dos locales genera rowIds distintos.
- Reimportar el mismo archivo da los mismos rowIds, también con las líneas idénticas en otro orden.
- `sin_datos` sigue saliendo en `skippedRows`.
- El link no vincula una línea con la compra de otro proveedor con el mismo comprobante.

## 3. Riesgos

- **Duplicados reales en el archivo del ERP.** Si el ERP exportara dos veces la misma línea por error, ahora se guardarían las dos y el detalle sumaría de más. Contra eso hay evidencia: en los casos verificados, las líneas repetidas son reales (la suma coincide con Compras).
- **Tiempo de corrida.** Son unas 90.000 líneas; el ETL actual las procesa en chunks de 500. Se corre por local y se mide en el dry-run.

## 4. Decisiones

- **Confirmado por el usuario (14-oct-2026):** no hay archivos de detalle importados por fuera de Drive. Toda la historia está en el bucket, así que el paso 3 no borra nada sin reemplazo. El chequeo del dry-run se mantiene como resguardo.
- **Pendiente:** OK del usuario para correr `--apply` contra producción después de revisar el dry-run.
