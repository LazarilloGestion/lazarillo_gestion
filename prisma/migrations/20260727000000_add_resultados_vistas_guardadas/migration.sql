-- CreateTable
CREATE TABLE "resultados_vistas_guardadas" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "param" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "meses" INTEGER[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resultados_vistas_guardadas_pkey" PRIMARY KEY ("id")
);
