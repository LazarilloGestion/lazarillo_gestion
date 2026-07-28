-- AlterTable
ALTER TABLE "resultados_vistas_guardadas" ALTER COLUMN "param" DROP NOT NULL;
ALTER TABLE "resultados_vistas_guardadas" ALTER COLUMN "value" DROP NOT NULL;
ALTER TABLE "resultados_vistas_guardadas" ALTER COLUMN "label" DROP NOT NULL;
ALTER TABLE "resultados_vistas_guardadas" ADD COLUMN "conceptosVisibles" TEXT[] NOT NULL DEFAULT '{}';
