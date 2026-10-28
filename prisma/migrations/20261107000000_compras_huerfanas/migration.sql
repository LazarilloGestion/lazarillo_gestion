-- Filas de compras que MaxiRest ya no tiene (Diego 28/10/2026): cuando en MaxiRest se edita un
-- gasto (importe, concepto, observación, tipo de comprobante) el Panel traía la versión nueva y
-- dejaba la vieja → gasto contado dos veces. Se marcan acá (y se ponen en $0 en el Panel, sin
-- borrarlas). Si la fila vuelve a aparecer en MaxiRest, se restaura sola.
-- estado: propuesta (detectada, sin tocar) | aplicada (en $0) | restaurada
CREATE TABLE "compras_huerfanas" (
    "rowId" TEXT NOT NULL,
    "puntoDeVentaId" INTEGER NOT NULL,
    "fecha" DATE,
    "comprobante" TEXT,
    "codigo" TEXT,
    "proveedor" TEXT,
    "concepto" TEXT,
    "importe" DECIMAL(18,2),
    "importeManualAntes" DECIMAL(18,2),
    "observacManualAntes" TEXT,
    "motivo" TEXT NOT NULL,
    "estado" TEXT NOT NULL,
    "detectadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compras_huerfanas_pkey" PRIMARY KEY ("rowId")
);

CREATE INDEX "compras_huerfanas_puntoDeVentaId_estado_idx" ON "compras_huerfanas"("puntoDeVentaId", "estado");

-- Sin acceso por la API pública de Supabase (el Panel entra por Prisma).
ALTER TABLE "compras_huerfanas" ENABLE ROW LEVEL SECURITY;
