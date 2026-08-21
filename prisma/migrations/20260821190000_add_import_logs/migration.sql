-- CreateTable
CREATE TABLE "import_logs" (
    "id" SERIAL NOT NULL,
    "batchId" TEXT NOT NULL,
    "fileType" TEXT,
    "fileName" TEXT NOT NULL,
    "storagePath" TEXT,
    "localId" INTEGER,
    "puntoDeVentaId" INTEGER,
    "estado" TEXT NOT NULL,
    "totalRows" INTEGER,
    "created" INTEGER,
    "updated" INTEGER,
    "skipped" INTEGER,
    "errors" JSONB,
    "skippedRows" JSONB,
    "errorMessage" TEXT,
    "durationMs" INTEGER,
    "triggeredBy" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_logs_batchId_idx" ON "import_logs"("batchId");

-- CreateIndex
CREATE INDEX "import_logs_fileType_creadoEn_idx" ON "import_logs"("fileType", "creadoEn");
