-- Concepto fijo por empleado (Diego 29/10/2026): todo lo de un empleado va a un concepto de caja.
CREATE TABLE IF NOT EXISTS "reglas_concepto_empleado" (
  "id" SERIAL PRIMARY KEY,
  "entidadId" TEXT NOT NULL,
  "nombre" TEXT,
  "origenPuntoDeVentaId" INTEGER NOT NULL,
  "conceptoCodigo" TEXT NOT NULL,
  "modo" TEXT NOT NULL,
  "fechaDesde" TIMESTAMP(3),
  "fechaHasta" TIMESTAMP(3),
  "extremosInclusivos" BOOLEAN NOT NULL DEFAULT true,
  "estado" TEXT NOT NULL DEFAULT 'activa',
  "creadoPor" TEXT,
  "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "reglas_concepto_empleado_pdv_idx" ON "reglas_concepto_empleado" ("origenPuntoDeVentaId", "estado");

-- Qué regla puso el concepto (NULL = lo puso una persona o no hay override).
ALTER TABLE "compras" ADD COLUMN IF NOT EXISTS "conceptoPorRegla" INTEGER;
CREATE INDEX IF NOT EXISTS "compras_conceptoPorRegla_idx" ON "compras" ("conceptoPorRegla") WHERE "conceptoPorRegla" IS NOT NULL;
