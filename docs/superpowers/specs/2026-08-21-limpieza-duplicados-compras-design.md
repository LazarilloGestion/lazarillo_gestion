# Limpieza de compras duplicadas en producción

> Spec arquitectónica. Sub-proyecto 2 del bug de duplicados — ver `docs/superpowers/specs/2026-08-21-promocion-main-fix-duplicados-design.md` (sub-proyecto 1, ya cerrado: cortó la fuente de nuevos duplicados) y `project_fix_duplicados_main_dev.md` en memoria del proyecto.

## 1. Problema

La causa raíz del bug de duplicados de compras (dos esquemas de `rowId` distintos escribiendo a la misma base) ya está cortada — `main` fue promovida a `dev` el 21-ago-2026. Pero las filas ya duplicadas por ese mecanismo, mientras estuvo activo, siguen en la base de producción.

**Alcance del problema** (confirmado con query de solo lectura, 21-ago-2026): 4.585 grupos de compras duplicadas, 9.170 filas (62% de las 14.707 compras totales), ~$862.887.402,81 de importe duplicado, 100% en Ramos Mejía (Bar y Canchas), rango enero-octubre 2026.

**Estructura del dataset** (verificada, sin excepciones sobre los 4.585 grupos):
- Cada grupo tiene exactamente 2 filas: una cuyo `rowId` coincide con el esquema nuevo (`lib/etl/normalizers/compra-identity.ts`, el único vigente ahora) y una que no.
- `localId` e `importe` son idénticos entre las dos filas de cada grupo (misma transacción real).
- 0 filas duplicadas tienen `esDistribuido = true`.
- 0 filas del esquema viejo (candidatas a borrar) tienen `detalle_compras` asociado — el detalle ya está enganchado a la fila del esquema nuevo. La FK `detalle_compras.compraId → compras.rowId` es `ON DELETE SET NULL` (no CASCADE), así que si hubiera detalle propio de una fila vieja se perdería el enlace al borrarla — pero no es el caso en ninguno de los 4.585 grupos.

## 2. Alcance

Borrar, de forma segura y auditable, las 4.585 filas del esquema viejo en cada grupo duplicado — quedándose con la fila del esquema nuevo.

**Fuera de alcance**: cualquier cambio de esquema, cualquier lógica de reporting/dashboard (no hace falta tocar nada ahí — al desaparecer la fila vieja, las sumas ya dan el número correcto sin cambios de código).

## 3. Decisiones tomadas con el usuario

- **Rastro auditable**: `pg_dump` completo de la base antes de borrar (mismo patrón que fases anteriores) + un JSON exportado fuera del repo con el detalle exacto de cada fila borrada (`rowId`, `importe`, `fecha`, `localId`) como respaldo contable.
- **Vida del script**: permanente en el repo (`scripts/cleanup-duplicados-compras.ts`), con test de su función pura de planificación — mismo criterio que `scripts/migrate-rowid-compras.ts`, documenta qué se hizo y por qué queda disponible para consulta futura.
- **Fuente de verdad al momento de borrar**: se recalculan los duplicados EN VIVO contra la base real al ejecutar (no se usa el JSON de la investigación de hoy como lista fija) — más seguro ante cualquier cambio entre el dry-run y el `--apply`.

## 4. Diseño

### 4.1 `scripts/cleanup-duplicados-compras.ts`

Mismo patrón que `scripts/migrate-rowid-compras.ts`: dry-run por default, requiere `--apply` para ejecutar de verdad contra la base real.

**Función pura, testable sin DB**: `planCleanupDuplicados(compras: CompraParaLimpieza[]): PlanLimpieza`

```ts
interface CompraParaLimpieza {
  rowId: string;
  codCga: string | null;
  fecha: Date | null;
  codigo: string | null;
  concepto: string | null;
  comprobante: string | null;
  detalle: string | null;
  observac: string | null;
  importe: { toString(): string } | null;
  esDistribuido: boolean;
  tieneDetalleCompras: boolean;
}

interface PlanLimpieza {
  rowIdABorrar: string[];
  gruposExcluidos: { motivo: string; rowIds: string[] }[];
}
```

Agrupa por (`codCga`, `fecha`, `codigo`, `concepto`, `detalle`, `observac`, `importe`) — mismos campos que la investigación original. Para cada grupo con más de 1 fila:
- Recalcula el `rowId` esperado con el esquema nuevo (`computeCompraRowId`/`compraIdentityFromDbRecord`, mismas funciones que ya usa `migrate-rowid-compras.ts`).
- Si el grupo no tiene EXACTAMENTE 2 filas, o no tiene EXACTAMENTE 1 fila que matchee el esquema nuevo y 1 que no: excluir el grupo entero, motivo `"forma inesperada (no es 1 vieja + 1 nueva)"`.
- Si la fila candidata a borrar (la que no matchea el esquema nuevo) tiene `esDistribuido = true`: excluir el grupo, motivo `"la fila candidata a borrar tiene esDistribuido=true"`.
- Si la fila candidata a borrar tiene `tieneDetalleCompras = true`: excluir el grupo, motivo `"la fila candidata a borrar tiene detalle_compras propio"`.
- Si pasa todos los chequeos: agregar el `rowId` de la fila vieja a `rowIdABorrar`.

Un grupo excluido no aborta el proceso — se reporta aparte y no se toca, ni en dry-run ni en `--apply`.

### 4.2 Ejecución (dry-run)

```
npx tsx scripts/cleanup-duplicados-compras.ts
```

- Corre `planCleanupDuplicados` contra los datos reales (leídos, no escritos).
- Imprime: cantidad de grupos totales analizados, cantidad a borrar, cantidad de grupos excluidos (con motivo), importe total que se liberaría.
- Exporta el detalle completo de `rowIdABorrar` (con `importe`, `fecha`, `localId` de cada fila) a un JSON fuera del repo (mismo directorio de scratchpad que ya se usó hoy para la investigación), como base del respaldo contable.
- No escribe nada en la base.

### 4.3 Ejecución (`--apply`)

```
npx tsx scripts/cleanup-duplicados-compras.ts --apply
```

Precondición manual (fuera del script, el usuario la ejecuta antes): `pg_dump` completo de la base.

El script, dentro de una única `prisma.$transaction`:
1. Vuelve a correr `planCleanupDuplicados` (recálculo en vivo, no reusa el resultado del dry-run anterior si pasó tiempo entre medio).
2. Cuenta `compras` antes del borrado.
3. `DELETE FROM compras WHERE "rowId" IN (...)` sobre exactamente los `rowIdABorrar` del plan recién calculado.
4. Cuenta `compras` después — debe ser exactamente `antes - rowIdABorrar.length`. Si no coincide, la transacción aborta (algo cambió la base en simultáneo — más seguro abortar que continuar a ciegas).
5. Al confirmar, imprime el resumen final y reexporta el JSON del listado efectivamente borrado (mismo formato que el dry-run) para el respaldo contable definitivo.

## 5. Seguridad y reversibilidad

- `pg_dump` completo obligatorio antes de `--apply` — el usuario lo corre y confirma explícitamente antes de que el script continúe (el script no lo automatiza, para forzar que sea una decisión consciente en el momento, mismo criterio que fases anteriores de este proyecto).
- Todo el borrado corre dentro de una transacción — si algo falla a mitad de camino, no queda un estado parcial.
- El JSON exportado (dry-run y post-apply) sirve como registro exacto de qué se borró, para reconstruir manualmente si hiciera falta.
- Grupos con cualquier forma de riesgo (esDistribuido, detalle propio, forma inesperada) se excluyen automáticamente — no se fuerza el borrado de un caso no verificado como seguro.
- Esta spec no re-abre la discusión de si es correcto borrar (ya se decidió que sí, en el brainstorming del sub-proyecto 1) — solo diseña cómo hacerlo de forma segura.

## 6. Testing

`scripts/cleanup-duplicados-compras.test.ts` (mismo patrón que `migrate-rowid-compras.test.ts`), cubriendo `planCleanupDuplicados`:
- Grupo limpio de 2 filas (1 vieja + 1 nueva, sin `esDistribuido` ni detalle) → la vieja va a `rowIdABorrar`.
- Grupo con la fila candidata a borrar en `esDistribuido = true` → grupo excluido, no se borra nada de ese grupo.
- Grupo con la fila candidata a borrar con `tieneDetalleCompras = true` → grupo excluido.
- Grupo con 3+ filas → excluido (forma inesperada).
- Grupo con 2 filas que matchean AMBAS el esquema nuevo (no debería pasar según la investigación, pero se cubre igual) → excluido.
- Sin duplicados (todas las compras son grupos de 1 fila) → `rowIdABorrar` vacío, sin grupos excluidos.

No hay test de integración contra DB real (mismo criterio ya establecido en el proyecto — sin DB de test separada); la verificación real es el propio dry-run corrido contra producción antes del `--apply`, y los conteos antes/después dentro de la transacción.

## 7. Alcance cerrado

Esta spec cubre únicamente el borrado de las 4.585 filas ya identificadas del esquema viejo. No cubre: cambios de schema, cambios en dashboards/reportes (no hacen falta), ni ningún otro dato fuera de la tabla `compras` (ya confirmado que `detalle_compras` no tiene huérfanos que resolver).
