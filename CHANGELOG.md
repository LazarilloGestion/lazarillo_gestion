# Changelog

## 2026-06-09

### Correcciones (revisión de código)

**ETL — integridad de datos**

- **makeRowId normaliza OBSERVAC antes de hashear** — La clave de upsert ahora aplica el mismo `normalizeText` que se usa al almacenar. Antes, variaciones de mayúsculas o espacios en el ERP generaban un `rowId` distinto y producían filas duplicadas en lugar de actualizar la existente.
- **localId en detalle_compras** — Se agrega la columna `localId` a la tabla `detalle_compras` (migración + backfill de filas ya vinculadas). El ETL la rellena al importar y el link por comprobante la usa como filtro en ambos lados del JOIN, eliminando el riesgo de vincular líneas de un local al comprobante homónimo de otro.
- **Link por comprobante no corre si todos los chunks fallaron** — `linkDetalleComprasByComprobante` ahora solo se ejecuta si al menos una fila fue creada o actualizada, evitando re-linkear con datos anteriores cuando el ETL falla completo.

**Dashboard — pivot y detalle**

- **Pivot incluye compras con `fecha = NULL` y `fechaManual` válida** — El guard `fecha IS NOT NULL` en `buildPivotConditions` se reemplazó por `(fecha IS NOT NULL OR fechaManual IS NOT NULL)`, de modo que registros ingresados solo con fecha manual ya no son ignorados silenciosamente.
- **OR por comprobante en detalle de líneas scoped a filas no vinculadas** — Al buscar líneas de una compra, el fallback por `comprobante` ahora restringe a `compraId: null`. Antes podía devolver líneas de otro local que ya estuvieran vinculadas a su propia compra con el mismo string de comprobante.
- **Límite de seguridad en endpoints de detalle** — Los endpoints `/api/dashboard/detalle` y `/api/dashboard/detalle-ventas` volvieron a tener un límite de filas (`take: 2000`) para evitar payloads masivos en datasets sin filtrar.

**Dashboard — UI**

- **Selector de concepto sin colisión por nombre duplicado** — El `CommandItem` del combobox de conceptos usa `"${codigo} ${nombre}"` como valor interno (en lugar de solo `nombre`), evitando que dos conceptos con el mismo nombre se traten como uno solo en el filtro de teclado de cmdk.
- **Búsqueda en detalle de compras incluye `observacManual`** — El buscador del modal ahora busca también sobre el valor editado manualmente, no solo sobre el original del ERP.

**API**

- **`observacManual` vacío se convierte a `null` server-side** — El schema Zod del PATCH aplica un transform `"" → null`, previniendo que una llamada directa a la API almacene cadena vacía y rompa el indicador de campo editado.

---

## 2026-06-08

### Correcciones

- **Fechas corregidas impactan el dashboard** — Los filtros de año y mes ahora usan la fecha editada manualmente cuando existe, en lugar de la fecha original del ERP. Los totales del dashboard reflejan exactamente lo configurado.

- **Ventas con pago partido muestran local y sucursal correctamente** — En ventas con múltiples formas de cobro, las filas secundarias ahora heredan el local y la sucursal de la fila principal. Antes quedaban en blanco.

- **Líneas de compra siempre vinculadas al importar** — Al cargar archivos de compras, el sistema vincula automáticamente las líneas de detalle al comprobante correspondiente sin importar el orden de importación.

### Nuevas funcionalidades

- **Observación editable en compras** — Desde el detalle de compras es posible editar la observación de un registro sin modificar los datos originales del ERP. El registro editado se distingue visualmente con un indicador.

- **Buscador en los paneles de detalle** — Los modales de detalle de compras y ventas incluyen un campo de búsqueda que filtra registros en tiempo real. En compras busca por proveedor, observación, detalle, concepto y rubro. En ventas, por tipo, forma de cobro, turno, comprobante, mesa y mozo. El pie muestra cuántos registros coinciden.

- **Selector de concepto con búsqueda** — Al editar una compra, el campo Concepto pasó de lista desplegable a un buscador: se tipea parte del nombre y filtra las opciones al instante.
