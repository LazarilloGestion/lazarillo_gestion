"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import {
  FileSpreadsheet, CheckCircle2, AlertCircle, X,
  FolderOpen, Folder, RefreshCw, CloudDownload, Settings, SearchX, ChevronDown,
  Loader2,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ETLReport } from "@/lib/etl/types";
import { translateError } from "@/lib/etl/error-messages";
import type { DriveFile, DriveConfig, DriveFilesResponse } from "@/lib/drive/types";

// ── tipos ────────────────────────────────────────────────────────────────────

type DriveFilesState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: DriveFilesResponse }
  | { status: "error"; message: string };

type FileImportStatus = "idle" | "importing" | "success" | "error";
type FileStates = Record<string, FileImportStatus>;
type FileReports = Record<string, ETLReport[]>;
type FileErrors = Record<string, string>;

const FILE_TYPE_LABELS: Record<string, string> = {
  rubrosConceptoCaja: "Rubros Concepto Caja",
  rubrosArticulo:     "Rubros Artículo",
  subrubrosArticulo:  "Subrubros Artículo",
  conceptosCaja:      "Conceptos Caja",
  articulos:          "Artículos",
  proveedores:        "Proveedores",
  compras:            "Compras",
  detalleCompras:     "Detalle Compras",
  ventas:             "Ventas",
};

// ── Reconectar Drive ──────────────────────────────────────────────────────────

function ReconectarDriveButton() {
  const [loading, setLoading] = useState(false);
  async function handleReconectar() {
    setLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=/importar`,
          scopes: "openid email profile https://www.googleapis.com/auth/drive.readonly",
          queryParams: { prompt: "consent", access_type: "offline" },
        },
      });
      if (error) setLoading(false);
    } catch {
      setLoading(false);
    }
  }
  return (
    <button
      onClick={handleReconectar}
      disabled={loading}
      className="self-start text-xs underline underline-offset-2 text-red-500/80 hover:text-red-500 transition-colors disabled:opacity-50"
    >
      {loading ? "Redirigiendo…" : "Reconectar con Google Drive"}
    </button>
  );
}

// ── componente principal ──────────────────────────────────────────────────────

export default function ImportarPage() {
  const [maestrosLoaded, setMaestrosLoaded] = useState<boolean | null>(null);
  useEffect(() => {
    fetch("/api/etl/maestros-status")
      .then((r) => r.json() as Promise<{ loaded: boolean }>)
      .then((d) => setMaestrosLoaded(d.loaded))
      .catch(() => setMaestrosLoaded(false));
  }, []);

  return (
    <div className="p-4 md:p-6 flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-white">
          Importar datos
        </h1>
        <p className="text-sm text-muted-foreground">
          Importá archivos Excel del ERP desde Google Drive.
        </p>
      </div>

      <DriveTab maestrosLoaded={maestrosLoaded} onMaestrosChange={setMaestrosLoaded} />
    </div>
  );
}

// ── Tab: Desde Drive ──────────────────────────────────────────────────────────

function DriveTab({
  maestrosLoaded,
  onMaestrosChange,
}: {
  maestrosLoaded: boolean | null;
  onMaestrosChange: (loaded: boolean) => void;
}) {
  const [config, setConfig] = useState<DriveConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [folderUrl, setFolderUrl] = useState("");
  const [savingConfig, setSavingConfig] = useState(false);
  const [configError, setConfigError] = useState("");

  const [filesState, setFilesState] = useState<DriveFilesState>({ status: "idle" });

  const [fileStatuses, setFileStatuses] = useState<FileStates>({});
  const [fileReports, setFileReports] = useState<FileReports>({});
  const [fileErrors, setFileErrors] = useState<FileErrors>({});
  const [globalImporting, setGlobalImporting] = useState(false);

  useEffect(() => {
    fetch("/api/drive/config")
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d: DriveConfig) => setConfig(d))
      .catch(() => setConfig({ folder_id: null, folder_name: null }))
      .finally(() => setConfigLoading(false));
  }, []);

  const loadFiles = useCallback(() => {
    setFilesState({ status: "loading" });
    setFileStatuses({});
    setFileReports({});
    setFileErrors({});
    fetch("/api/drive/files")
      .then((r) => r.json() as Promise<DriveFilesResponse & { error?: string }>)
      .then((d) => {
        if (d.error) setFilesState({ status: "error", message: d.error });
        else setFilesState({ status: "ready", data: { maestros: d.maestros ?? [], folders: d.folders ?? [] } });
      })
      .catch(() => setFilesState({ status: "error", message: "Error de red" }));
  }, []);

  useEffect(() => {
    if (!configLoading && config?.folder_id) loadFiles();
  }, [configLoading, config?.folder_id, loadFiles]);

  const isImporting = Object.values(fileStatuses).some((s) => s === "importing");

  const anyImporting = isImporting || globalImporting;
  useEffect(() => {
    if (!anyImporting) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [anyImporting]);

  async function saveConfig(e: React.SyntheticEvent) {
    e.preventDefault();
    setConfigError("");
    setSavingConfig(true);
    try {
      const res = await fetch("/api/drive/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder_url: folderUrl }),
      });
      const d = await res.json() as DriveConfig & { error?: string };
      if (!res.ok) { setConfigError(d.error ?? "Error guardando"); return; }
      setConfig({ folder_id: d.folder_id, folder_name: d.folder_name });
      setShowSettings(false);
      setFolderUrl("");
    } catch {
      setConfigError("Error de red");
    } finally {
      setSavingConfig(false);
    }
  }

  async function importOneFile(file: DriveFile, localId?: number, puntoDeVentaId?: number): Promise<{ ok: boolean; records: number }> {
    setFileStatuses((s) => ({ ...s, [file.id]: "importing" }));
    try {
      const res = await fetch("/api/etl/drive-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_id: file.id,
          file_name: file.name,
          local_id: localId,
          punto_de_venta_id: puntoDeVentaId,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setFileStatuses((s) => ({ ...s, [file.id]: "error" }));
        setFileErrors((s) => ({ ...s, [file.id]: json.error ?? "Error" }));
        return { ok: false, records: 0 };
      } else if (Array.isArray(json)) {
        const reports = json as ETLReport[];
        setFileStatuses((s) => ({ ...s, [file.id]: "success" }));
        setFileReports((s) => ({ ...s, [file.id]: reports }));
        const records = reports.reduce((s, r) => s + r.created + r.updated, 0);
        return { ok: true, records };
      } else {
        setFileStatuses((s) => ({ ...s, [file.id]: "error" }));
        setFileErrors((s) => ({ ...s, [file.id]: "Respuesta inesperada del servidor" }));
        return { ok: false, records: 0 };
      }
    } catch {
      setFileStatuses((s) => ({ ...s, [file.id]: "error" }));
      setFileErrors((s) => ({ ...s, [file.id]: "Error de red" }));
      return { ok: false, records: 0 };
    }
  }

  async function importAllFiles(files: DriveFile[], localId?: number, puntoDeVentaId?: number): Promise<{ errors: number; total: number; records: number }> {
    let errors = 0;
    let records = 0;
    for (const file of files) {
      const result = await importOneFile(file, localId, puntoDeVentaId);
      if (!result.ok) errors++;
      records += result.records;
    }
    fetch("/api/etl/maestros-status")
      .then((r) => r.json() as Promise<{ loaded: boolean }>)
      .then((d) => onMaestrosChange(d.loaded))
      .catch(() => {});
    return { errors, total: files.length, records };
  }

  async function importarTodo() {
    if (!ready) return;
    setGlobalImporting(true);
    let totalFiles = 0;
    let totalErrors = 0;
    let totalRecords = 0;
    let foldersBlocked = false;
    try {
      if (ready.maestros.length > 0) {
        const r = await importAllFiles(ready.maestros);
        totalFiles += r.total;
        totalErrors += r.errors;
        totalRecords += r.records;
      }
      if (ready.folders.length > 0) {
        const { loaded } = await fetch("/api/etl/maestros-status").then((r) => r.json() as Promise<{ loaded: boolean }>);
        onMaestrosChange(loaded);
        if (!loaded) {
          foldersBlocked = true;
          return;
        }
        for (const folder of ready.folders) {
          const r = await importAllFiles(folder.files, folder.localId ?? undefined, folder.puntoDeVentaId ?? undefined);
          totalFiles += r.total;
          totalErrors += r.errors;
          totalRecords += r.records;
        }
      }
    } finally {
      setGlobalImporting(false);
      if (foldersBlocked) {
        toast.warning("Maestros no cargados", {
          description: totalFiles > 0
            ? `Se procesaron ${totalFiles} archivo${totalFiles !== 1 ? "s" : ""} maestros pero los transaccionales no se importaron`
            : "Los archivos transaccionales no se importaron — los maestros no están disponibles",
          duration: Infinity,
        });
      } else if (totalFiles > 0) {
        if (totalErrors === 0) {
          toast.success("Importación completada", {
            description: `${totalFiles} archivo${totalFiles !== 1 ? "s" : ""} procesados · ${totalRecords} registros`,
            duration: Infinity,
          });
        } else {
          toast.error("Importación con errores", {
            description: `${totalErrors} de ${totalFiles} archivo${totalFiles !== 1 ? "s" : ""} fallaron — revisá los detalles`,
            duration: Infinity,
          });
        }
      }
    }
  }

  function resetFile(fileId: string) {
    setFileStatuses((s) => { const n = { ...s }; delete n[fileId]; return n; });
    setFileReports((r) => { const n = { ...r }; delete n[fileId]; return n; });
    setFileErrors((e) => { const n = { ...e }; delete n[fileId]; return n; });
  }

  const ready = filesState.status === "ready" ? filesState.data : null;

  if (configLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-zinc-400">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Config de carpeta */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/30 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100 dark:border-zinc-700/50">
          <div className="flex items-center gap-2">
            {showSettings || !config?.folder_id
              ? <FolderOpen className="w-4 h-4 text-zinc-400" />
              : <Folder className="w-4 h-4 text-zinc-400" />}
            <span className="text-sm font-medium text-zinc-900 dark:text-white">
              Carpeta de Drive
            </span>
          </div>
          <button
            onClick={() => { setShowSettings((v) => !v); setConfigError(""); }}
            className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors"
            title="Configurar carpeta"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 py-3 flex flex-col gap-3">
          {config?.folder_id ? (
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-medium text-zinc-900 dark:text-white">
                {config.folder_name ?? config.folder_id}
              </span>
              <span className="text-xs font-mono text-zinc-400">{config.folder_id}</span>
            </div>
          ) : (
            <p className="text-sm text-zinc-400">Sin carpeta configurada</p>
          )}
          {(showSettings || !config?.folder_id) && (
            <form onSubmit={saveConfig} className="flex flex-col gap-2">
              <Input
                placeholder="https://drive.google.com/drive/folders/..."
                value={folderUrl}
                onChange={(e) => setFolderUrl(e.target.value)}
                className="text-sm border-zinc-200 dark:border-zinc-700 font-mono"
              />
              {configError && (
                <p className="text-xs text-red-500">{configError}</p>
              )}
              <button
                type="submit"
                disabled={savingConfig || !folderUrl.trim()}
                className="h-8 px-3 rounded-md bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-xs font-medium self-start transition-all hover:bg-zinc-700 dark:hover:bg-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {savingConfig ? "Guardando…" : "Guardar carpeta"}
              </button>
            </form>
          )}
        </div>
      </div>

      {/* Estados de carga */}
      {filesState.status === "loading" && (
        <div className="flex items-center justify-center py-12 text-zinc-400">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      )}
      {filesState.status === "error" && (
        <div className="flex flex-col gap-2 rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 px-4 py-3">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-500" />
            <p className="text-sm text-red-700 dark:text-red-400">{filesState.message}</p>
          </div>
          {(filesState.message.toLowerCase().includes("token") ||
            filesState.message.toLowerCase().includes("revoc") ||
            filesState.message.toLowerCase().includes("sesión")) && (
            <ReconectarDriveButton />
          )}
        </div>
      )}

      {/* Botones de acción global */}
      {config?.folder_id && filesState.status !== "loading" && (
        <div className="flex items-center justify-end gap-3">
          {ready && (() => {
            const allFiles = [...ready.maestros, ...ready.folders.flatMap((f) => f.files)];
            const hayPendientes = allFiles.some((f) => !fileStatuses[f.id] || fileStatuses[f.id] === "idle" || fileStatuses[f.id] === "error");
            const todoDone = allFiles.length > 0 && allFiles.every((f) => fileStatuses[f.id] === "success");

            if (todoDone) {
              return (
                <button
                  onClick={async () => {
                    allFiles.forEach((f) => resetFile(f.id));
                    await importarTodo();
                  }}
                  disabled={globalImporting || isImporting}
                  className="flex items-center gap-1.5 h-7 px-3 rounded-md border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-600 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <RefreshCw className="w-3 h-3" />
                  Reimportar todo
                </button>
              );
            }

            return hayPendientes ? (
              <button
                onClick={importarTodo}
                disabled={globalImporting || isImporting}
                className="flex items-center gap-1.5 h-7 px-3 rounded-md border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-600 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {globalImporting ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <CloudDownload className="w-3.5 h-3.5" />
                )}
                {globalImporting ? "Importando…" : "Importar todo"}
              </button>
            ) : null;
          })()}
          <button
            onClick={loadFiles}
            disabled={isImporting || globalImporting}
            className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors disabled:opacity-40 disabled:pointer-events-none"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Actualizar
          </button>
        </div>
      )}

      {/* Maestros */}
      {ready && (
        <div className="flex flex-col gap-3">
          <span className="text-xs font-medium uppercase tracking-widest text-zinc-400 dark:text-zinc-500">
            Maestros
          </span>
          <DriveFolder
            title="Maestros"
            subtitle="Rubros, conceptos, proveedores, artículos"
            files={ready.maestros}
            localId={undefined}
            puntoDeVentaId={undefined}
            fileStatuses={fileStatuses}
            fileReports={fileReports}
            fileErrors={fileErrors}
            onImportOne={importOneFile}
            onImportAll={importAllFiles}
            globalImporting={globalImporting}
            onResetFile={resetFile}
          />
        </div>
      )}

      {/* Carpetas PDV */}
      {ready && ready.folders.length > 0 && (
        <span className="text-xs font-medium uppercase tracking-widest text-zinc-400 dark:text-zinc-500">
          Transaccionales
        </span>
      )}
      {ready?.folders.map((folder) => {
        const resolved = folder.localId
          ? [folder.localNombre, folder.pdvNombre].filter(Boolean).join(" · ")
          : null;
        return (
          <DriveFolder
            key={folder.id}
            title={folder.name}
            subtitle={resolved ?? "Local no reconocido — verificá el nombre de la carpeta"}
            subtitleVariant={folder.localId ? "normal" : "warning"}
            files={folder.files}
            localId={folder.localId ?? undefined}
            puntoDeVentaId={folder.puntoDeVentaId ?? undefined}
            fileStatuses={fileStatuses}
            fileReports={fileReports}
            fileErrors={fileErrors}
            onImportOne={importOneFile}
            onImportAll={importAllFiles}
            blocked={maestrosLoaded !== true}
            globalImporting={globalImporting}
            onResetFile={resetFile}
          />
        );
      })}

      {/* Sin archivos */}
      {ready && ready.maestros.length === 0 && ready.folders.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-14 text-zinc-400">
          <SearchX className="w-7 h-7 opacity-40" />
          <div className="text-center">
            <p className="text-sm">No se encontraron archivos ni subcarpetas.</p>
            <p className="text-xs opacity-60 mt-0.5 font-mono">
              Maestros/ · San Justo/ · Ramos Mejía/…
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── DriveFolder ───────────────────────────────────────────────────────────────

function DriveFolder({
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
  globalImporting?: boolean;
  onResetFile: (fileId: string) => void;
}) {
  const [batchRunning, setBatchRunning] = useState(false);
  const [collapsed, setCollapsed] = useState(true);

  const pendingFiles = files.filter((f) => !fileStatuses[f.id] || fileStatuses[f.id] === "idle" || fileStatuses[f.id] === "error");
  const allDone = files.length > 0 && files.every((f) => fileStatuses[f.id] === "success");
  const folderImporting = files.some((f) => fileStatuses[f.id] === "importing");

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
                <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-400" />
              )}
              {allDone && !folderImporting && !batchRunning && (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
              )}
            </div>
            {subtitle && (
              <p className={cn(
                "text-xs mt-0.5 truncate",
                subtitleVariant === "warning"
                  ? "text-amber-600 dark:text-amber-400"
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
              className="flex items-center gap-1.5 h-7 px-3 rounded-md border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-600 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {batchRunning ? (
                <Loader2 className="w-3 h-3 animate-spin" />
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
            <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-50 dark:bg-amber-950/20 border-b border-amber-100 dark:border-amber-900/30 text-xs text-amber-700 dark:text-amber-400">
              Importar maestros primero antes de importar transaccionales.
            </div>
          )}
          {folderImporting && (
            <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-50 dark:bg-amber-950/20 border-b border-amber-100 dark:border-amber-900/30 text-xs text-amber-700 dark:text-amber-400">
              <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" />
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
                      <FileSpreadsheet className="w-4 h-4 shrink-0 text-emerald-500" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-mono text-zinc-900 dark:text-white truncate">
                          {file.name}
                        </p>
                        <p className="text-xs text-zinc-400 mt-0.5">
                          {new Date(file.modifiedTime).toLocaleDateString("es-AR")}
                          {file.size && ` · ${formatBytes(Number(file.size))}`}
                        </p>
                        {status === "error" && fileErrors[file.id] && (
                          <p className="text-xs text-red-500 mt-0.5">{translateError(fileErrors[file.id])}</p>
                        )}
                      </div>
                      {status === "success" ? (
                        <button
                          onClick={async () => { onResetFile(file.id); await onImportOne(file, localId, puntoDeVentaId); }}
                          disabled={batchRunning || globalImporting}
                          title="Reimportar archivo"
                          className="group shrink-0 disabled:pointer-events-none"
                        >
                          <CheckCircle2 className="w-4 h-4 text-emerald-500 group-hover:hidden" />
                          <RefreshCw className="w-4 h-4 text-zinc-400 hidden group-hover:block" />
                        </button>
                      ) : status === "error" ? (
                        <button
                          onClick={async () => { onResetFile(file.id); await onImportOne(file, localId, puntoDeVentaId); }}
                          disabled={batchRunning || globalImporting}
                          title="Reimportar archivo"
                          className="group shrink-0 disabled:pointer-events-none"
                        >
                          <AlertCircle className="w-4 h-4 text-red-500 group-hover:hidden" />
                          <RefreshCw className="w-4 h-4 text-zinc-400 hidden group-hover:block" />
                        </button>
                      ) : status === "importing" ? (
                        <Loader2 className="w-4 h-4 animate-spin text-zinc-400 shrink-0" />
                      ) : (
                        <button
                          onClick={() => onImportOne(file, localId, puntoDeVentaId)}
                          disabled={batchRunning || blocked || globalImporting}
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

// ── ReportCard ────────────────────────────────────────────────────────────────

import { Badge } from "@/components/ui/badge";

function ReportCard({ report }: { report: ETLReport }) {
  return (
    <div className="rounded-lg border border-zinc-100 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
        <span className="text-sm font-medium text-zinc-900 dark:text-white">
          {FILE_TYPE_LABELS[report.fileType] ?? report.fileType}
        </span>
        <span className="text-xs text-zinc-400 font-mono ml-auto">
          {report.totalRows} filas · {report.durationMs}ms
        </span>
      </div>

      <div className="flex gap-2 flex-wrap">
        <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/40 dark:text-emerald-400 border-0 text-xs">
          {report.created} creados
        </Badge>
        <Badge variant="secondary" className="text-xs">{report.updated} actualizados</Badge>
        <Badge variant="outline" className="text-xs">{report.skipped} omitidos</Badge>
        {report.errors.length > 0 && (
          <Badge variant="destructive" className="text-xs">{report.errors.length} errores</Badge>
        )}
      </div>

      {report.errors.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 font-medium transition-colors">
            Ver {report.errors.length} errores
          </summary>
          <ul className="mt-2 space-y-1 max-h-48 overflow-y-auto">
            {report.errors.map((e, i) => (
              <li key={i} className="font-mono text-zinc-500 dark:text-zinc-400">
                Fila {e.rowIndex + 1} · {String(e.rawCodigo ?? "?")} · {translateError(e.message)}
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
