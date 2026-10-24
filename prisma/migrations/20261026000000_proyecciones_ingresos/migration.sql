-- Proyecciones de cierre de mes guardadas día a día (tooltip de Ingresos).
-- Se guardan los dos métodos para medir, con el mes ya cerrado, cuál erró menos
-- en cada local/PDV y usar ese.
CREATE TABLE IF NOT EXISTS "proyecciones_ingresos" (
    "ambito" TEXT NOT NULL,
    "anio" INTEGER NOT NULL,
    "mes" INTEGER NOT NULL,
    "corte" DATE NOT NULL,
    "metodo" TEXT NOT NULL,
    "facturado" DECIMAL(16,2) NOT NULL,
    "proyeccion" DECIMAL(16,2) NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "proyecciones_ingresos_pkey" PRIMARY KEY ("ambito", "anio", "mes", "corte", "metodo")
);

-- El panel entra por Prisma (rol postgres); RLS cierra el acceso por la API pública.
ALTER TABLE "proyecciones_ingresos" ENABLE ROW LEVEL SECURITY;
