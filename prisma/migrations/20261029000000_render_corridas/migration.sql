-- CreateTable
CREATE TABLE "render_corridas" (
    "id" SERIAL NOT NULL,
    "inicio" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fin" TIMESTAMP(3),
    "estado" TEXT NOT NULL,
    "origen" TEXT NOT NULL,
    "total" INTEGER NOT NULL DEFAULT 0,
    "hechos" INTEGER NOT NULL DEFAULT 0,
    "actual" TEXT,
    "resumen" JSONB,

    CONSTRAINT "render_corridas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "render_corridas_inicio_idx" ON "render_corridas"("inicio");

ALTER TABLE "render_corridas" ENABLE ROW LEVEL SECURITY;
