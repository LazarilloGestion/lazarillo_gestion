-- Nómina de MaxiRest (000 - nomina) por PDV: nombre y apellido de los empleados,
-- para mostrar los sueldos aperturados con su nombre completo. Más adelante se
-- conecta con rrhh_empleados de la base de la app (Render) por PDV + código.
CREATE TABLE IF NOT EXISTS "empleados" (
    "id" SERIAL NOT NULL,
    "puntoDeVentaId" INTEGER NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT,
    "apellido" TEXT,
    "fechaBaja" DATE,
    "actualizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "empleados_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "empleados_puntoDeVentaId_codigo_key" ON "empleados"("puntoDeVentaId", "codigo");
