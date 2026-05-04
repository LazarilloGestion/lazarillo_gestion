-- CreateTable
CREATE TABLE "locales" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,

    CONSTRAINT "locales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "puntos_de_venta" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "localId" INTEGER NOT NULL,

    CONSTRAINT "puntos_de_venta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rubros_concepto_caja" (
    "id" SERIAL NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "calcRent" TEXT,

    CONSTRAINT "rubros_concepto_caja_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conceptos_caja" (
    "id" SERIAL NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipo" TEXT,
    "codImp" TEXT,
    "codRga" TEXT,

    CONSTRAINT "conceptos_caja_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rubros_articulo" (
    "id" SERIAL NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "color" TEXT,
    "grupoNro" TEXT,
    "grupoCol" TEXT,
    "grupoFot" TEXT,
    "excluyeInf" BOOLEAN,
    "evento" TEXT,
    "deliAct" BOOLEAN,
    "eveFor" TEXT,
    "eveForm" TEXT,
    "eveFormH" TEXT,
    "discont" DECIMAL(65,30),
    "fechaUpda" TIMESTAMP(3),
    "modoVista" TEXT,

    CONSTRAINT "rubros_articulo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subrubros_articulo" (
    "id" SERIAL NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "deliAct" BOOLEAN,
    "eveFor" TEXT,
    "eveForm" TEXT,
    "eveFormH" TEXT,
    "fechaUpda" TIMESTAMP(3),
    "codRua" TEXT,

    CONSTRAINT "subrubros_articulo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "articulos" (
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "precio1" DECIMAL(65,30),
    "precio2" DECIMAL(65,30),
    "precio3" DECIMAL(65,30),
    "precio4" DECIMAL(65,30),
    "codRua" TEXT,
    "codSua" TEXT,

    CONSTRAINT "articulos_pkey" PRIMARY KEY ("codigo")
);

-- CreateTable
CREATE TABLE "proveedores" (
    "id" SERIAL NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT,
    "razon" TEXT,
    "direccion" TEXT,
    "localidad" TEXT,
    "contacto" TEXT,
    "telefono" TEXT,
    "fax" TEXT,
    "celular" TEXT,
    "tipoIva" TEXT,
    "cuit" TEXT,
    "cbu" TEXT,
    "aliasCbu" TEXT,
    "diasVenc" INTEGER,
    "iva" DECIMAL(65,30),
    "ivaDif" DECIMAL(65,30),
    "email" TEXT,
    "observac" TEXT,
    "fecUltipp" TIMESTAMP(3),
    "detPerc" TEXT,

    CONSTRAINT "proveedores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compras" (
    "rowId" TEXT NOT NULL,
    "comprobante" TEXT,
    "codCga" TEXT,
    "concepto" TEXT,
    "fecha" TIMESTAMP(3),
    "codigo" TEXT,
    "proveedor" TEXT,
    "detalle" TEXT,
    "observac" TEXT,
    "importe" DECIMAL(65,30),
    "importeTrabajado" DECIMAL(65,30),
    "impInt" DECIMAL(65,30),
    "imputac" TEXT,
    "per1" DECIMAL(65,30),
    "per2" DECIMAL(65,30),
    "per3" DECIMAL(65,30),
    "localId" INTEGER,
    "puntoDeVentaId" INTEGER,
    "conceptoCodigo" TEXT,
    "proveedorId" INTEGER,

    CONSTRAINT "compras_pkey" PRIMARY KEY ("rowId")
);

-- CreateTable
CREATE TABLE "detalle_compras" (
    "rowId" TEXT NOT NULL,
    "codPro" TEXT,
    "codCpb" TEXT,
    "numero1" TEXT,
    "numero2" TEXT,
    "comprobante" TEXT,
    "fecha" TIMESTAMP(3),
    "codigo" TEXT,
    "nombre" TEXT,
    "medida" TEXT,
    "cantidad" DECIMAL(65,30),
    "neto" DECIMAL(65,30),
    "totalIns" DECIMAL(65,30),
    "naTot" DECIMAL(65,30),
    "impNtTot" DECIMAL(65,30),
    "tasa" DECIMAL(65,30),
    "iva" DECIMAL(65,30),
    "impInt" DECIMAL(65,30),
    "percep" DECIMAL(65,30),
    "observac" TEXT,
    "compraId" TEXT,
    "articuloCodigo" TEXT,
    "proveedorId" INTEGER,

    CONSTRAINT "detalle_compras_pkey" PRIMARY KEY ("rowId")
);

-- CreateTable
CREATE TABLE "ventas" (
    "rowId" TEXT NOT NULL,
    "turno" TEXT,
    "comprobant" TEXT,
    "hora" TEXT,
    "tipo" TEXT,
    "mesa" TEXT,
    "mozo" TEXT,
    "cub" TEXT,
    "cobro" TEXT,
    "codCobro" TEXT,
    "importe" DECIMAL(65,30),
    "importeTrabajado" DECIMAL(65,30),
    "total" DECIMAL(65,30),
    "descuento" DECIMAL(65,30),
    "cliNombre" TEXT,
    "cliRazon" TEXT,
    "cliCut" TEXT,
    "fecha" TIMESTAMP(3),
    "codSuc" TEXT,
    "nombreSuc" TEXT,
    "cupon" TEXT,
    "localId" INTEGER,
    "puntoDeVentaId" INTEGER,

    CONSTRAINT "ventas_pkey" PRIMARY KEY ("rowId")
);

-- CreateIndex
CREATE UNIQUE INDEX "locales_nombre_key" ON "locales"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "puntos_de_venta_nombre_localId_key" ON "puntos_de_venta"("nombre", "localId");

-- CreateIndex
CREATE UNIQUE INDEX "rubros_concepto_caja_codigo_key" ON "rubros_concepto_caja"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "conceptos_caja_codigo_key" ON "conceptos_caja"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "rubros_articulo_codigo_key" ON "rubros_articulo"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "subrubros_articulo_codigo_key" ON "subrubros_articulo"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "proveedores_codigo_key" ON "proveedores"("codigo");

-- CreateIndex
CREATE INDEX "compras_fecha_idx" ON "compras"("fecha");

-- CreateIndex
CREATE INDEX "compras_localId_puntoDeVentaId_idx" ON "compras"("localId", "puntoDeVentaId");

-- CreateIndex
CREATE INDEX "compras_comprobante_idx" ON "compras"("comprobante");

-- CreateIndex
CREATE INDEX "detalle_compras_comprobante_idx" ON "detalle_compras"("comprobante");

-- CreateIndex
CREATE INDEX "detalle_compras_compraId_idx" ON "detalle_compras"("compraId");

-- CreateIndex
CREATE INDEX "ventas_fecha_idx" ON "ventas"("fecha");

-- CreateIndex
CREATE INDEX "ventas_localId_puntoDeVentaId_idx" ON "ventas"("localId", "puntoDeVentaId");

-- AddForeignKey
ALTER TABLE "puntos_de_venta" ADD CONSTRAINT "puntos_de_venta_localId_fkey" FOREIGN KEY ("localId") REFERENCES "locales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conceptos_caja" ADD CONSTRAINT "conceptos_caja_codRga_fkey" FOREIGN KEY ("codRga") REFERENCES "rubros_concepto_caja"("codigo") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subrubros_articulo" ADD CONSTRAINT "subrubros_articulo_codRua_fkey" FOREIGN KEY ("codRua") REFERENCES "rubros_articulo"("codigo") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "articulos" ADD CONSTRAINT "articulos_codRua_fkey" FOREIGN KEY ("codRua") REFERENCES "rubros_articulo"("codigo") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "articulos" ADD CONSTRAINT "articulos_codSua_fkey" FOREIGN KEY ("codSua") REFERENCES "subrubros_articulo"("codigo") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compras" ADD CONSTRAINT "compras_localId_fkey" FOREIGN KEY ("localId") REFERENCES "locales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compras" ADD CONSTRAINT "compras_puntoDeVentaId_fkey" FOREIGN KEY ("puntoDeVentaId") REFERENCES "puntos_de_venta"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compras" ADD CONSTRAINT "compras_conceptoCodigo_fkey" FOREIGN KEY ("conceptoCodigo") REFERENCES "conceptos_caja"("codigo") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compras" ADD CONSTRAINT "compras_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "proveedores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "detalle_compras" ADD CONSTRAINT "detalle_compras_compraId_fkey" FOREIGN KEY ("compraId") REFERENCES "compras"("rowId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "detalle_compras" ADD CONSTRAINT "detalle_compras_articuloCodigo_fkey" FOREIGN KEY ("articuloCodigo") REFERENCES "articulos"("codigo") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "detalle_compras" ADD CONSTRAINT "detalle_compras_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "proveedores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ventas" ADD CONSTRAINT "ventas_localId_fkey" FOREIGN KEY ("localId") REFERENCES "locales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ventas" ADD CONSTRAINT "ventas_puntoDeVentaId_fkey" FOREIGN KEY ("puntoDeVentaId") REFERENCES "puntos_de_venta"("id") ON DELETE SET NULL ON UPDATE CASCADE;
