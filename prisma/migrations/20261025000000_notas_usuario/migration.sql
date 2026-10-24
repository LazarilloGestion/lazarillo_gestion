-- Block de notas del menú lateral: una nota por usuario.
CREATE TABLE IF NOT EXISTS "notas_usuario" (
    "email" TEXT NOT NULL,
    "texto" TEXT NOT NULL DEFAULT '',
    "actualizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notas_usuario_pkey" PRIMARY KEY ("email")
);

-- El panel entra por Prisma (rol postgres); RLS cierra el acceso por la API pública.
ALTER TABLE "notas_usuario" ENABLE ROW LEVEL SECURITY;
