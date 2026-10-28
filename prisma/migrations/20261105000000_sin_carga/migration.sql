-- "Sin carga" (Diego, 28/10/2026): gastos de todos los meses que se marcaron "Ya no va" en un PDV.
-- CreateTable
CREATE TABLE "sin_carga_descartes" (
    "id" SERIAL NOT NULL,
    "pdvId" INTEGER NOT NULL,
    "clave" TEXT NOT NULL,
    "nombre" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creadoPor" TEXT,

    CONSTRAINT "sin_carga_descartes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sin_carga_descartes_pdvId_clave_key" ON "sin_carga_descartes"("pdvId", "clave");

-- Sin acceso por la API pública de Supabase (el Panel entra por Prisma).
ALTER TABLE "sin_carga_descartes" ENABLE ROW LEVEL SECURITY;
