-- Switch Económica / Financiera (Diego, 26/10/2026): el kit suma al 14 tres
-- columnas para gastos varios (G) y sueldos (E). Fecha y caja del pago (vista
-- financiera) y, en sueldos, el mes que liquidan (vista económica).
ALTER TABLE "compras" ADD COLUMN "fechaPago" TIMESTAMP(3);
ALTER TABLE "compras" ADD COLUMN "cajaPago" TEXT;
ALTER TABLE "compras" ADD COLUMN "periodo" TIMESTAMP(3);
