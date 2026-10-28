-- Carga de EMPLEADOS desde el Panel (Diego 28/10/2026): sueldos y adelantos cargados a mano
-- (cuando la liquidación no sale de Lazarillo). Cada carga genera filas en compras
-- (rowId "emp-<id>-…", origen 'lazarillo') como los sueldos de MaxiRest; acá queda la cabecera
-- para la cuenta del empleado y para poder anularla (anular borra sus filas).
-- tipo: sueldo | adelanto
CREATE TABLE "liquidaciones_empleado" (
    "id" SERIAL NOT NULL,
    "tipo" TEXT NOT NULL,
    "puntoDeVentaId" INTEGER NOT NULL,
    "localId" INTEGER NOT NULL,
    "empleadoCodigo" TEXT NOT NULL,
    "empleadoNombre" TEXT NOT NULL,
    "periodo" DATE NOT NULL,
    "fechaPago" DATE NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "adelantos" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "payload" JSONB NOT NULL,
    "creadoPor" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "anuladoEn" TIMESTAMP(3),
    "anuladoPor" TEXT,

    CONSTRAINT "liquidaciones_empleado_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "liquidaciones_empleado_pdv_empleado_periodo_idx" ON "liquidaciones_empleado"("puntoDeVentaId", "empleadoCodigo", "periodo");

-- Sin acceso por la API pública de Supabase (el Panel entra por Prisma).
ALTER TABLE "liquidaciones_empleado" ENABLE ROW LEVEL SECURITY;
