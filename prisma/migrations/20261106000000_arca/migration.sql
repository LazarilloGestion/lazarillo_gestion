-- Comprobantes recibidos de ARCA ("Mis Comprobantes", CSV) — Diego 28/10/2026: para ver lo
-- que falta cargar (real, no proyectado) y corregir errores de carga (importe, número, fecha).
-- CreateTable
CREATE TABLE "arca_comprobantes" (
    "id" SERIAL NOT NULL,
    "cuitReceptor" TEXT NOT NULL,
    "cuitEmisor" TEXT NOT NULL,
    "emisor" TEXT,
    "tipo" INTEGER NOT NULL,
    "puntoVenta" INTEGER NOT NULL,
    "numero" BIGINT NOT NULL,
    "fecha" DATE NOT NULL,
    "cae" TEXT,
    "moneda" TEXT,
    "tipoCambio" DECIMAL(18,6),
    "neto" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "noGravado" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "exento" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "otrosTributos" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "iva" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,2) NOT NULL,
    "importadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "importadoPor" TEXT,

    CONSTRAINT "arca_comprobantes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "arca_comprobantes_cuitEmisor_tipo_puntoVenta_numero_key" ON "arca_comprobantes"("cuitEmisor", "tipo", "puntoVenta", "numero");
CREATE INDEX "arca_comprobantes_fecha_idx" ON "arca_comprobantes"("fecha");

-- Sin acceso por la API pública de Supabase (el Panel entra por Prisma).
ALTER TABLE "arca_comprobantes" ENABLE ROW LEVEL SECURITY;
