# Promoción de `dev` a `main` — corte de la fuente de duplicados

> Spec arquitectónica. Ver `docs/superpowers/plans/` para el plan ejecutable derivado de esta spec.

## 1. Problema

El cliente reportó hoy (21-ago-2026) registros de compras duplicados en la app deployada en Vercel (rama `main`). Investigación de causa raíz (systematic-debugging, completada en esta misma sesión) confirmó con evidencia directa contra la base de producción:

- `main` calcula el `rowId` de cada compra con un esquema de hash simple (`lib/etl/normalizers/compras.ts`, función `makeRowId` original).
- `dev` reemplazó ese esquema por uno nuevo (`lib/etl/normalizers/compra-identity.ts`, identidad "partida" con/sin comprobante) como parte de la Fase A de Apertura de Gastos, y corrió `scripts/migrate-rowid-compras.ts --apply` contra la base real, recalculando el `rowId` de **todas** las compras existentes.
- Ambas ramas escriben a la **misma base de datos de producción** — no hay separación prod/dev.
- Cada reimportación de compras hecha desde la app deployada (`main`) calcula un `rowId` que ya no coincide con el esquema nuevo persistido → el `INSERT ... ON CONFLICT` no encuentra la fila existente → inserta una fila duplicada de la misma transacción real.

**Evidencia cuantificada** (query de solo lectura contra producción, 21-ago-2026): 4.585 grupos de compras duplicadas, 9.170 filas (62% de las 14.707 compras totales), ~$862.887.402,81 de importe duplicado, 100% concentrado en Ramos Mejía (San Justo sin ningún duplicado), rango enero-octubre 2026. Ninguna fila duplicada tiene una regla de Apertura de Gastos aplicada (`esDistribuido=true`: 0 casos). Ventas no está afectado (esquema de identidad sin cambios entre ramas).

**Hallazgo que simplifica la solución**: `origin/main` es un ancestro directo de `dev` (`git merge-base --is-ancestor origin/main HEAD` → true). No hay historias divergentes que reconciliar — `dev` es `main` + 63 commits del módulo de Apertura de Gastos (Fases A-D), sin ningún commit propio de `main` que falte en `dev`. La corrección no requiere un merge complejo, solo poner `main` al día.

## 2. Alcance de esta spec

Cortar la fuente de nuevos duplicados promoviendo `dev` a `main`, para que solo quede un código escribiendo a la base de producción (el que ya usa el esquema de `rowId` correcto).

**Explícitamente fuera de alcance** (sub-proyecto separado, a brainstormear después de este deploy): limpiar los 4.585 grupos de compras ya duplicados en producción. No se toca ni una fila de datos existente como parte de este trabajo.

## 3. Decisiones ya tomadas con el usuario

- **Visibilidad de la UI de Apertura de Gastos**: se acepta que aparezca en producción tal cual está en `dev` (sin gate/flag). No cambia ningún número (0 reglas activas en toda la base), así que no hay riesgo funcional — es puramente que el cliente la va a poder ver y abrir por primera vez.
- **Alcance del contenido a promover**: se incluyen también los cambios de UI/validación hechos en esta misma sesión sobre el modal de Apertura de Gastos (espaciado, bloqueo de destinos superpuestos, fix de inputs numéricos que no se podían vaciar) — no solo el último commit ya pusheado de Fase D (`b611df1`). Estos cambios ya pasaron `tsc`/lint/tests limpios en cada paso de esta sesión, pero no pasaron por una revisión de código formal — se documenta como el trade-off aceptado explícitamente por el usuario.
- **Mecanismo de promoción**: push directo (`git push origin dev:main`), sin PR intermedio — elegido explícitamente por el usuario en lugar de la opción recomendada (PR), priorizando velocidad sobre registro auditable formal.

## 4. Secuencia

1. **Commit del pulido de hoy a `dev`**: agrupar los cambios de esta sesión (9 archivos: `apertura-destino-row.tsx`, `apertura-gastos-modal.tsx`, `apertura-timeline.tsx`, `apertura-vigencia-selector.tsx`, `components/ui/dialog.tsx`, `lib/apertura/schemas.ts`+test, `lib/apertura/validaciones.ts`+test) en uno o más commits de Conventional Commits, siguiendo el estilo ya usado en el repo (`fix(apertura-gastos): ...`). Push a `origin/dev`.
2. **Build de producción real**: `npm run build` sobre ese `dev` actualizado (corre `prisma generate` + build de Next — no se corrió esta sesión, es el paso más parecido a lo que Vercel va a ejecutar). Debe terminar sin errores antes de continuar.
3. **Promoción**: `git push origin dev:main` — fast-forward de `main` al mismo commit que `dev` (sin conflictos esperados, confirmado que `origin/main` es ancestro directo).
4. **Verificación de deploy**: confirmar en el dashboard de Vercel que el deploy contra el nuevo `main` termina exitosamente (build + deploy verde).
5. **Verificación funcional post-deploy**: navegar la app en producción y confirmar que las pantallas existentes (Compras, Ventas, Resultados) siguen funcionando igual que antes — esto es shippear ~10.000 líneas de cambios de una sola vez, no solo el fix puntual del `rowId`.
6. **Confirmación del fix real**: no hay forma de confirmar "no habrá más duplicados" sin esperar la próxima reimportación real de compras del cliente. Se documenta como seguimiento: la próxima vez que se reimporte un archivo de compras, verificar (query de solo lectura) que no aparecen filas nuevas con el esquema de `rowId` viejo.

## 5. Seguridad y reversibilidad

- El push directo a `main` es una acción sobre una rama compartida con el cliente en producción — autorizada explícitamente por el usuario en esta conversación, para este cambio puntual (no autoriza pushes directos futuros a `main` de forma general).
- **Rollback**: si el deploy falla o el build/verificación post-deploy encuentra un problema, `main` puede revertirse a su commit anterior (`git push origin <commit-anterior>:main --force`, con confirmación explícita del usuario antes de ejecutar un force-push) o mediante un rollback manual desde el dashboard de Vercel (Vercel mantiene deploys anteriores disponibles para promover de vuelta sin necesidad de tocar git).
- No se ejecuta ninguna migración de Prisma como parte de este trabajo — el schema de producción ya está migrado (Fases A-D se aplicaron en sesiones anteriores). `npm run build` solo corre `prisma generate` (no `migrate deploy`).
- No se toca ningún dato de compras/ventas ya importado como parte de este trabajo — el fix es de código, no de datos.

## 6. Testing

- `npx vitest run`, `npx tsc --noEmit`, `npm run lint`: ya verificados limpios en cada paso de esta sesión (280/280 tests) — se vuelven a correr una vez consolidados los commits de hoy, como parte del paso 1.
- `npm run build`: pendiente, paso 2 de la secuencia — es la verificación nueva que agrega esta spec por encima de lo ya hecho.
- No hay test automatizado posible para "se cortó la generación de duplicados" (depende de una reimportación real futura) — se documenta como verificación manual de seguimiento, no bloqueante para el deploy.

## 7. Alcance cerrado

Esta spec cubre únicamente la promoción de código (`dev` → `main`) para cortar la fuente de nuevos duplicados. La limpieza de los 4.585 grupos ya duplicados en producción es un sub-proyecto separado, con su propio brainstorming, spec y plan, a iniciar después de confirmar que este deploy fue exitoso.
