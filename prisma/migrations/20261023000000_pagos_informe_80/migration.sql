-- Informe 80 (pagos) + concepto de caja por línea en el 25 + flag de pago automático por proveedor.

-- Proveedores: pago automático (débito, retención en liquidación) → sus facturas sin pago no son deuda
ALTER TABLE "proveedores" ADD COLUMN "pagoAutomatico" BOOLEAN NOT NULL DEFAULT false;

-- Detalle de compras (informe 25): COD_CGA / NOM_CGA, columnas nuevas de MaxiRest desde oct-2026
ALTER TABLE "detalle_compras" ADD COLUMN "codCga" TEXT;
ALTER TABLE "detalle_compras" ADD COLUMN "nomCga" TEXT;
CREATE INDEX "detalle_compras_codCga_idx" ON "detalle_compras"("codCga");

-- Pagos (informe 80): una fila por pago aplicado a un comprobante
CREATE TABLE "pagos" (
    "rowId" TEXT NOT NULL,
    "fecha" TIMESTAMP(3),
    "codCpb" TEXT,
    "prefijo" TEXT,
    "numero" TEXT,
    "comprobante" TEXT,
    "codPro" TEXT,
    "proveedor" TEXT,
    "total" DECIMAL(65,30),
    "codCga" TEXT,
    "concepto" TEXT,
    "medio" TEXT,
    "importe" DECIMAL(65,30),
    "fechaPago" TIMESTAMP(3),
    "orden" TEXT,
    "secuencia" INTEGER NOT NULL DEFAULT 1,
    "fechaVal" TIMESTAMP(3),
    "numeroVal" TEXT,
    "codBan" TEXT,
    "banco" TEXT,
    "impVal" DECIMAL(65,30),
    "proveedorId" INTEGER,
    "localId" INTEGER,
    "puntoDeVentaId" INTEGER,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pagos_pkey" PRIMARY KEY ("rowId")
);

CREATE INDEX "pagos_localId_puntoDeVentaId_comprobante_codPro_idx" ON "pagos"("localId", "puntoDeVentaId", "comprobante", "codPro");
CREATE INDEX "pagos_fechaPago_idx" ON "pagos"("fechaPago");
CREATE INDEX "pagos_proveedorId_idx" ON "pagos"("proveedorId");

ALTER TABLE "pagos" ADD CONSTRAINT "pagos_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "proveedores"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_localId_fkey" FOREIGN KEY ("localId") REFERENCES "locales"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_puntoDeVentaId_fkey" FOREIGN KEY ("puntoDeVentaId") REFERENCES "puntos_de_venta"("id") ON DELETE SET NULL ON UPDATE CASCADE;
