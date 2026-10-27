-- CreateTable
CREATE TABLE "facturas_lazarillo" (
    "id" SERIAL NOT NULL,
    "localId" INTEGER NOT NULL,
    "comprobante" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "proveedorId" INTEGER NOT NULL,
    "fecha" DATE NOT NULL,
    "total" DECIMAL(16,2) NOT NULL,
    "payload" JSONB NOT NULL,
    "creadoPor" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoPor" TEXT,
    "actualizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "facturas_lazarillo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "actividad" (
    "id" SERIAL NOT NULL,
    "tipo" TEXT NOT NULL,
    "accion" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "refId" TEXT,
    "localId" INTEGER,
    "usuario" TEXT,
    "datos" JSONB,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "actividad_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "facturas_lazarillo_localId_comprobante_codigo_key" ON "facturas_lazarillo"("localId", "comprobante", "codigo");

-- CreateIndex
CREATE INDEX "actividad_creadoEn_idx" ON "actividad"("creadoEn");
