-- Gestor de medios de pago (Diego, 27/10/2026): una sola lista para todo el Panel.
-- CreateTable
CREATE TABLE "medios_pago" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'otro',
    "pideId" BOOLEAN NOT NULL DEFAULT false,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "medios_pago_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "medios_pago_nombre_key" ON "medios_pago"("nombre");

-- Los tres que ya usaba Impagas (los pagos cargados quedan enganchados por nombre).
INSERT INTO "medios_pago" ("nombre", "tipo", "pideId", "orden") VALUES
  ('Transferencia', 'banco', true, 1),
  ('Caja Mayor', 'caja', false, 2),
  ('Bancos', 'banco', true, 3)
ON CONFLICT ("nombre") DO NOTHING;

-- Cualquier otro medio que ya esté en un pago, para no dejarlo huérfano.
INSERT INTO "medios_pago" ("nombre", "tipo", "orden")
SELECT DISTINCT p."medio", 'otro', 99 FROM "pagos_internos" p
ON CONFLICT ("nombre") DO NOTHING;
