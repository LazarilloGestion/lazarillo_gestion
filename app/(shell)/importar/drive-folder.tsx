"use client";

import { useState } from "react";
import {
  FileSpreadsheet, CheckCircle2, AlertCircle, Info,
  FolderOpen, Folder, RefreshCw, CloudDownload, ChevronDown,
} from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { Badge } from "@/components/ui/badge";
import { cn, fmtARS } from "@/lib/utils";
import type { ETLReport } from "@/lib/etl/types";
import { translateError } from "@/lib/etl/error-messages";
import { FilaOmitidaDetalle, FilaErrorDetalle } from "./fila-omitida";
import type { DriveFile } from "@/lib/drive/types";
import type { FileStates, FileReports, FileErrors } from "@/hooks/use-drive-import";

const FILE_TYPE_LABELS: Record<string, string> = {
  rubrosConceptoCaja: "Rubros Concepto Caja",
  rubrosArticulo:     "Rubros Artículo",
  subrubrosArticulo:  "Subrubros Artículo",
  conceptosCaja:      "Conceptos Caja",
  articulos:          "Artículos",
  proveedores:        "Proveedores",
  compras:            "Compras",
  detalleCompras:     "Detalle Compras",
  pagos:              "Pagos",
  nomina:             "Nómina",
  ventas:             "Ventas",
};

export function DriveFolder({
  title,
  subtitle,
  subtitleVariant = "normal",
  files,
  localId,
  puntoDeVentaId,
  fileStatuses,
  fileReports,
  fileErrors,
  onImportOne,
  blocked = false,
  blockedTitle,
  globalImporting = false,
  onImportAll,
  onResetFile,
}: {
  title: string;
  subtitle?: string;
  subtitleVariant?: "normal" | "warning";
  files: DriveFile[];
  localId: number | undefined;
  puntoDeVentaId: number | undefined;
  fileStatuses: FileStates;
  fileReports: FileReports;
  fileErrors: FileErrors;
  onImportOne: (file: DriveFile, localId?: number, puntoDeVentaId?: number) => Promise<unknown>;
  onImportAll: (files: DriveFile[], localId?: number, puntoDeVentaId?: number) => Promise<unknown>;
  blocked?: boolean;
  blockedTitle?: string;
  globalImporting?: boolean;
  onResetFile: (fileId: string, forzar?: boolean) => void;
}) {
  const [batchRunning, setBatchRunning] = useState(false);
  const [collapsed, setCollapsed] = useState(true);

  const pendingFiles = files.filter((f) => !fileStatuses[f.id] || fileStatuses[f.id] === "idle" || fileStatuses[f.id] === "error");
  // Un archivo no soportado es un estado final igual que "success" — reintentarlo
  // da siempre el mismo resultado, así que no debe dejar la carpeta "incompleta".
  // "sin_cambios" (misma huella de Drive que la última importación OK) también es terminal.
  const terminado = (id: string) => ["success", "unsupported", "sin_cambios"].includes(fileStatuses[id] ?? "");
  const allDone = files.length > 0 && files.every((f) => terminado(f.id));
  const folderImporting = files.some((f) => fileStatuses[f.id] === "importing");

  // Mismo criterio que allDone: success/unsupported son estados terminales.
  const importedCount = files.filter((f) => terminado(f.id)).length;

  async function handleImportAll() {
    setBatchRunning(true);
    try {
      await onImportAll(pendingFiles, localId, puntoDeVentaId);
    } finally {
      setBatchRunning(false);
    }
  }

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/30 overflow-hidden">
      <div
        className="flex items-center justify-between gap-2 px-4 py-3 cursor-pointer select-none hover:bg-zinc-50 dark:hover:bg-zinc-700/30 transition-colors"
        onClick={() => setCollapsed((v) => !v)}
      >
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          {collapsed
            ? <Folder className="w-4 h-4 shrink-0 text-zinc-400" />
            : <FolderOpen className="w-4 h-4 shrink-0 text-zinc-400" />}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-zinc-900 dark:text-white">{title}</span>
              {(folderImporting || batchRunning) && (
                <span className="flex items-center gap-1.5">
                  <Spinner size="sm" />
                  <span className="text-xs text-zinc-400 font-mono">
                    {importedCount}/{files.length} importados
                  </span>
                </span>
              )}
              {allDone && !folderImporting && !batchRunning && (
                <CheckCircle2 className="w-3.5 h-3.5 text-success" />
              )}
            </div>
            {subtitle && (
              <p className={cn(
                "text-xs mt-0.5 truncate",
                subtitleVariant === "warning"
                  ? "text-warning"
                  : "text-zinc-400"
              )}>
                {subtitle}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {allDone && (
            <button
              onClick={async () => {
                files.forEach((f) => onResetFile(f.id));
                setBatchRunning(true);
                try {
                  await onImportAll(files, localId, puntoDeVentaId);
                } finally {
                  setBatchRunning(false);
                }
              }}
              disabled={batchRunning || globalImporting || blocked}
              className="flex items-center gap-1.5 h-7 px-3 rounded-md border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-600 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <RefreshCw className="w-3 h-3" />
              Reimportar
            </button>
          )}
          {files.length > 1 && !allDone && !collapsed && (
            <button
              onClick={handleImportAll}
              disabled={batchRunning || pendingFiles.length === 0 || blocked || globalImporting}
              title={blocked ? blockedTitle : undefined}
              className="flex items-center gap-1.5 h-7 px-3 rounded-md border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-600 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {batchRunning ? (
                <Spinner size="sm" />
              ) : (
                <CloudDownload className="w-3 h-3" />
              )}
              {batchRunning
                ? "Importando…"
                : `Importar ${pendingFiles.length > 0 ? pendingFiles.length : "todos"}`}
            </button>
          )}
          <ChevronDown className={cn(
            "w-4 h-4 text-zinc-400 transition-transform duration-150",
            collapsed && "-rotate-90"
          )} />
        </div>
      </div>

      {!collapsed && (
        <div className="border-t border-zinc-100 dark:border-zinc-700/50">
          {blocked && (
            <div className="flex items-center gap-2 px-4 py-2.5 bg-warning/10 border-b border-warning/15 text-xs text-warning">
              Importar maestros primero antes de importar transaccionales.
            </div>
          )}
          {folderImporting && (
            <div className="px-4 py-2.5 bg-warning/10 border-b border-warning/15 text-xs text-warning">
              Importación en curso — no navegues ni recargues la página hasta que termine.
            </div>
          )}

          {files.length === 0 ? (
            <p className="text-sm text-zinc-400 px-4 py-4">Sin archivos Excel.</p>
          ) : (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-700/50">
              {files.map((file) => {
                const status = fileStatuses[file.id] ?? "idle";
                const reports = fileReports[file.id] ?? [];
                return (
                  <div key={file.id}>
                    <div className="flex items-center gap-3 px-4 py-3">
                      <FileSpreadsheet className="w-4 h-4 shrink-0 text-success" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-mono text-zinc-900 dark:text-white truncate">
                          {file.name}
                        </p>
                        <p className="text-xs text-zinc-400 mt-0.5">
                          {new Date(file.modifiedTime).toLocaleDateString("es-AR")}
                          {file.size && ` · ${formatBytes(Number(file.size))}`}
                        </p>
                        {(status === "error" || status === "unsupported" || status === "sin_cambios") && fileErrors[file.id] && (
                          <p className={cn(
                            "text-xs mt-0.5",
                            status === "error" ? "text-destructive" : "text-zinc-400 dark:text-zinc-500"
                          )}>
                            {translateError(fileErrors[file.id])}
                          </p>
                        )}
                      </div>
                      {status === "success" ? (
                        <button
                          onClick={async () => { onResetFile(file.id, true); await onImportOne(file, localId, puntoDeVentaId); }}
                          disabled={batchRunning || globalImporting || blocked}
                          title="Reimportar archivo"
                          className="group shrink-0 disabled:pointer-events-none"
                        >
                          <CheckCircle2 className="w-4 h-4 text-success group-hover:hidden" />
                          <RefreshCw className="w-4 h-4 text-zinc-400 hidden group-hover:block" />
                        </button>
                      ) : status === "sin_cambios" ? (
                        <button
                          onClick={async () => { onResetFile(file.id, true); await onImportOne(file, localId, puntoDeVentaId); }}
                          disabled={batchRunning || globalImporting || blocked}
                          title="No cambió desde la última importación — clic para reimportarlo igual"
                          className="group shrink-0 disabled:pointer-events-none"
                        >
                          <CheckCircle2 className="w-4 h-4 text-zinc-300 dark:text-zinc-600 group-hover:hidden" />
                          <RefreshCw className="w-4 h-4 text-zinc-400 hidden group-hover:block" />
                        </button>
                      ) : status === "unsupported" ? (
                        <span title="Tipo de archivo no soportado por el sistema" className="shrink-0">
                          <Info className="w-4 h-4 text-zinc-400 dark:text-zinc-500" />
                        </span>
                      ) : status === "error" ? (
                        <button
                          onClick={async () => { onResetFile(file.id, true); await onImportOne(file, localId, puntoDeVentaId); }}
                          disabled={batchRunning || globalImporting || blocked}
                          title="Reimportar archivo"
                          className="group shrink-0 disabled:pointer-events-none"
                        >
                          <AlertCircle className="w-4 h-4 text-destructive group-hover:hidden" />
                          <RefreshCw className="w-4 h-4 text-zinc-400 hidden group-hover:block" />
                        </button>
                      ) : status === "importing" ? (
                        <Spinner className="shrink-0" />
                      ) : (
                        <button
                          onClick={() => onImportOne(file, localId, puntoDeVentaId)}
                          disabled={batchRunning || blocked || globalImporting}
                          title={blocked ? blockedTitle : undefined}
                          className="flex items-center gap-1.5 h-7 px-3 rounded-md border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-600 transition-all disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                        >
                          <CloudDownload className="w-3 h-3" />
                          Importar
                        </button>
                      )}
                    </div>
                    {reports.length > 0 && (
                      <div className="flex flex-col gap-2 px-4 pb-3">
                        {reports.map((r, i) => <ReportCard key={i} report={r} />)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ReportCard({ report }: { report: ETLReport }) {
  return (
    <div className="rounded-lg border border-zinc-100 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
        <span className="text-sm font-medium text-zinc-900 dark:text-white">
          {FILE_TYPE_LABELS[report.fileType] ?? report.fileType}
        </span>
        <span className="text-xs text-zinc-400 font-mono ml-auto">
          {report.totalRows} filas · {report.durationMs}ms
        </span>
      </div>

      <div className="flex gap-2 flex-wrap">
        <Badge className="bg-success/15 text-success hover:bg-success/15 border-0 text-xs">
          {report.created} creados
        </Badge>
        <Badge variant="secondary" className="text-xs">{report.updated} actualizados</Badge>
        {report.skipped > 0 && (
          <Badge variant="outline" className="text-xs">{report.skipped} omitidos</Badge>
        )}
        {report.comprasReconciliadas && report.comprasReconciliadas.length > 0 && (
          <Badge variant="secondary" className="text-xs">{report.comprasReconciliadas.length} reconciliados</Badge>
        )}
        {report.errors.length > 0 && (
          <Badge variant="destructive" className="text-xs">{report.errors.length} errores</Badge>
        )}
      </div>

      {report.skipped > 0 && (
        report.skippedRows && report.skippedRows.length > 0 ? (
          <details className="text-xs">
            <summary className="cursor-pointer text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 font-medium transition-colors">
              Ver {report.skippedRows.length} omitidos
            </summary>
            <ul className="mt-2 space-y-1.5 max-h-96 overflow-y-auto">
              {report.skippedRows.map((row, i) => (
                <li key={i} className="flex flex-col gap-0.5 text-zinc-500 dark:text-zinc-400">
                  <span className="font-mono">
                    {row.fila != null ? `Fila ${row.fila} · ` : ""}
                    {row.fecha ?? "—"}
                    {row.proveedor ? ` · ${row.proveedor}` : row.concepto ? ` · ${row.concepto}` : ""}
                    {row.importe ? ` · ${fmtARS(Number(row.importe))}` : ""}
                  </span>
                  <span className="text-zinc-400 dark:text-zinc-500">
                    {row.motivo === "sin_datos"
                      ? "Fila incompleta — falta código de cuenta o fecha"
                      : row.motivo === "cargada_en_lazarillo"
                        ? "Factura ya cargada en Lazarillo — queda la versión de Lazarillo"
                      : row.original
                        ? `Fila repetida dentro del archivo — repite a la fila ${row.original.fila}, que sí se cargó`
                        : "Fila repetida dentro del archivo"}
                  </span>
                  <FilaOmitidaDetalle row={row} />
                </li>
              ))}
            </ul>
          </details>
        ) : (
          <p className="text-xs text-zinc-400">
            {report.skipped} {report.skipped === 1 ? "fila omitida" : "filas omitidas"} — sin detalle disponible para este tipo de archivo.
          </p>
        )
      )}

      {report.errors.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 font-medium transition-colors">
            Ver {report.errors.length} errores
          </summary>
          <ul className="mt-2 space-y-1 max-h-96 overflow-y-auto">
            {report.errors.map((e, i) => (
              <li key={i} className="font-mono text-zinc-500 dark:text-zinc-400">
                Fila {e.fila ?? e.rowIndex + 1} · {String(e.rawCodigo ?? "?")} · {translateError(e.message)}
                <FilaErrorDetalle error={e} />
              </li>
            ))}
          </ul>
        </details>
      )}

      {report.reconciliacionesAmbiguas && report.reconciliacionesAmbiguas.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 font-medium transition-colors">
            Ver {report.reconciliacionesAmbiguas.length} reconciliaciones ambiguas
          </summary>
          <ul className="mt-2 space-y-1 max-h-48 overflow-y-auto">
            {report.reconciliacionesAmbiguas.map((r, i) => (
              <li key={i} className="font-mono text-zinc-500 dark:text-zinc-400">
                Posible duplicado sin resolver — {r.candidatos.length} candidatos encontrados, revisar manualmente
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
