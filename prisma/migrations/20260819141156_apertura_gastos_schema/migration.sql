-- AlterTable
ALTER TABLE "compras" ADD COLUMN     "distribuidoEn" TIMESTAMP(3),
ADD COLUMN     "esBloqueado" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "esDistribuido" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "reglas_apertura" (
    "id" SERIAL NOT NULL,
    "nivel" TEXT NOT NULL,
    "entidadId" TEXT NOT NULL,
    "modo" TEXT NOT NULL,
    "fechaDesde" TIMESTAMP(3),
    "fechaHasta" TIMESTAMP(3),
    "extremosInclusivos" BOOLEAN NOT NULL DEFAULT true,
    "estado" TEXT NOT NULL DEFAULT 'activa',
    "creadoPor" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reglas_apertura_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "destinos_regla" (
    "id" SERIAL NOT NULL,
    "reglaId" INTEGER NOT NULL,
    "localId" INTEGER,
    "puntoDeVentaId" INTEGER,
    "porcentaje" DECIMAL(5,2) NOT NULL,

    CONSTRAINT "destinos_regla_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "distribuciones_apertura" (
    "id" SERIAL NOT NULL,
    "compraRowId" TEXT NOT NULL,
    "reglaId" INTEGER NOT NULL,
    "destinoId" INTEGER NOT NULL,
    "importeOriginal" DECIMAL(14,2) NOT NULL,
    "porcentaje" DECIMAL(5,2) NOT NULL,
    "importeCalculado" DECIMAL(14,2) NOT NULL,
    "procesadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "distribuciones_apertura_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reglas_apertura_entidadId_nivel_idx" ON "reglas_apertura"("entidadId", "nivel");

-- CreateIndex
CREATE INDEX "destinos_regla_reglaId_idx" ON "destinos_regla"("reglaId");

-- CreateIndex
CREATE INDEX "distribuciones_apertura_compraRowId_idx" ON "distribuciones_apertura"("compraRowId");

-- AddForeignKey
ALTER TABLE "destinos_regla" ADD CONSTRAINT "destinos_regla_reglaId_fkey" FOREIGN KEY ("reglaId") REFERENCES "reglas_apertura"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "destinos_regla" ADD CONSTRAINT "destinos_regla_localId_fkey" FOREIGN KEY ("localId") REFERENCES "locales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "destinos_regla" ADD CONSTRAINT "destinos_regla_puntoDeVentaId_fkey" FOREIGN KEY ("puntoDeVentaId") REFERENCES "puntos_de_venta"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distribuciones_apertura" ADD CONSTRAINT "distribuciones_apertura_compraRowId_fkey" FOREIGN KEY ("compraRowId") REFERENCES "compras"("rowId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distribuciones_apertura" ADD CONSTRAINT "distribuciones_apertura_reglaId_fkey" FOREIGN KEY ("reglaId") REFERENCES "reglas_apertura"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distribuciones_apertura" ADD CONSTRAINT "distribuciones_apertura_destinoId_fkey" FOREIGN KEY ("destinoId") REFERENCES "destinos_regla"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
