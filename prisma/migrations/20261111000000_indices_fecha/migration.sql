-- Índices de fecha para que el panel y el celu carguen rápido (Diego 29/10/2026: "le cuesta
-- bastante cargar los datos"). Las consultas filtran el año como rango sobre la fecha efectiva
-- (COALESCE(fechaManual, fecha) en compras, fecha en ventas), casi siempre por PDV.
-- Solo agrega índices: no cambia ni borra datos. Para volver atrás alcanza con DROP INDEX.
CREATE INDEX IF NOT EXISTS "ventas_puntoDeVentaId_fecha_idx" ON "ventas" ("puntoDeVentaId", "fecha");
CREATE INDEX IF NOT EXISTS "compras_fecha_efectiva_idx" ON "compras" ((COALESCE("fechaManual", "fecha")));
CREATE INDEX IF NOT EXISTS "compras_puntoDeVentaId_fecha_efectiva_idx" ON "compras" ("puntoDeVentaId", (COALESCE("fechaManual", "fecha")));
CREATE INDEX IF NOT EXISTS "compras_fechaManual_idx" ON "compras" ("fechaManual") WHERE "fechaManual" IS NOT NULL;
