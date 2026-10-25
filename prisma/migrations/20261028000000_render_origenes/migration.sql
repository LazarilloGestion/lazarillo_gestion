-- CreateTable
CREATE TABLE "render_origenes" (
    "id" SERIAL NOT NULL,
    "esquema" TEXT NOT NULL,
    "pdv" TEXT NOT NULL,
    "localId" INTEGER NOT NULL,
    "puntoDeVentaId" INTEGER NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "render_origenes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "render_origenes_esquema_pdv_key" ON "render_origenes"("esquema", "pdv");

ALTER TABLE "render_origenes" ENABLE ROW LEVEL SECURITY;
