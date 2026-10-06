-- CreateTable
CREATE TABLE "sin_rubro_config" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "visibleEnDashboard" BOOLEAN NOT NULL DEFAULT true,
    "visibleEnResultados" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "sin_rubro_config_pkey" PRIMARY KEY ("id"),
    -- Prisma no puede expresar CHECK: garantiza a nivel DB que la tabla tenga una sola fila.
    CONSTRAINT "sin_rubro_config_single_row" CHECK ("id" = 1)
);

-- Fila inicial con los defaults (Compras sí, Resultados no).
INSERT INTO "sin_rubro_config" ("id") VALUES (1) ON CONFLICT DO NOTHING;
