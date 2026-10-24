"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import {
  AlertCircle, FolderOpen, Folder, RefreshCw, CloudDownload, Settings, SearchX,
} from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useFetchQuery } from "@/hooks/use-fetch-query";
import { useDriveImport } from "@/hooks/use-drive-import";
import type { DriveConfig, DriveFilesResponse } from "@/lib/drive/types";
import { DriveFolder } from "./drive-folder";

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
      className="self-start text-xs underline underline-offset-2 text-destructive/80 hover:text-destructive transition-colors disabled:opacity-50"
    >
      {loading ? "Redirigiendo…" : "Reconectar con Google Drive"}
    </button>
  );
}

// ── componente principal ──────────────────────────────────────────────────────

export default function ImportarPage() {
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

      <DriveTab />
    </div>
  );
}

// ── Tab: Desde Drive ──────────────────────────────────────────────────────────

function DriveTab() {
  const queryClient = useQueryClient();
  const [showSettings, setShowSettings] = useState(false);
  const [folderUrl, setFolderUrl] = useState("");
  const [savingConfig, setSavingConfig] = useState(false);
  const [configError, setConfigError] = useState("");

  const driveImport = useDriveImport();

  const configQuery = useFetchQuery<DriveConfig>(["drive-config"], "/api/drive/config");
  const configLoading = configQuery.isLoading;
  const config = configQuery.data ?? { folder_id: null, folder_name: null };

  const filesQuery = useQuery<DriveFilesResponse>({
    queryKey: ["drive-files", config.folder_id],
    queryFn: async () => {
      const r = await fetch("/api/drive/files");
      const d = await r.json() as DriveFilesResponse & { error?: string };
      if (d.error) throw new Error(d.error);
      return { maestros: d.maestros ?? [], folders: d.folders ?? [] };
    },
    enabled: !configLoading && !!config.folder_id,
    retry: false,
  });

  function loadFiles() {
    driveImport.resetAll();
    filesQuery.refetch();
  }

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
      queryClient.setQueryData<DriveConfig>(["drive-config"], { folder_id: d.folder_id, folder_name: d.folder_name });
      setShowSettings(false);
      setFolderUrl("");
    } catch {
      setConfigError("Error de red");
    } finally {
      setSavingConfig(false);
    }
  }

  const ready = filesQuery.data ?? null;

  if (configLoading) {
    // Skeleton del box "Carpeta de Drive" mientras carga la config.
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/30 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100 dark:border-zinc-700/50">
            <div className="flex items-center gap-2">
              <Skeleton className="w-4 h-4" />
              <Skeleton className="h-4 w-28" />
            </div>
            <Skeleton className="w-4 h-4" />
          </div>
          <div className="px-4 py-3">
            <div className="flex items-baseline gap-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-48" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Config de carpeta */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/30 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100 dark:border-zinc-700/50">
          <div className="flex items-center gap-2">
            {showSettings || !config.folder_id
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
          {config.folder_id ? (
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-medium text-zinc-900 dark:text-white">
                {config.folder_name ?? config.folder_id}
              </span>
              <span className="text-xs font-mono text-zinc-400">{config.folder_id}</span>
            </div>
          ) : (
            <p className="text-sm text-zinc-400">Sin carpeta configurada</p>
          )}
          {(showSettings || !config.folder_id) && (
            <form onSubmit={saveConfig} className="flex flex-col gap-2">
              <Input
                placeholder="https://drive.google.com/drive/folders/..."
                value={folderUrl}
                onChange={(e) => setFolderUrl(e.target.value)}
                className="text-sm border-zinc-200 dark:border-zinc-700 font-mono"
              />
              {configError && (
                <p className="text-xs text-destructive">{configError}</p>
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
      {filesQuery.isPending && filesQuery.fetchStatus !== "idle" && (
        <div className="flex items-center justify-center py-12">
          <Spinner size="lg" />
        </div>
      )}
      {filesQuery.isError && (
        <div className="flex flex-col gap-2 rounded-lg border border-destructive/25 bg-destructive/10 px-4 py-3">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-destructive" />
            <p className="text-sm text-destructive">{filesQuery.error.message}</p>
          </div>
          {(filesQuery.error.message.toLowerCase().includes("token") ||
            filesQuery.error.message.toLowerCase().includes("revoc") ||
            filesQuery.error.message.toLowerCase().includes("sesión")) && (
            <ReconectarDriveButton />
          )}
        </div>
      )}

      {/* Botones de acción global */}
      {config.folder_id && !(filesQuery.isPending && filesQuery.fetchStatus !== "idle") && (
        <div className="flex items-center justify-end gap-3">
          {ready && (() => {
            const allFiles = [...ready.maestros, ...ready.folders.filter((f) => f.localId).flatMap((f) => f.files)];
            const hayPendientes = allFiles.some((f) => !driveImport.fileStatuses[f.id] || driveImport.fileStatuses[f.id] === "idle" || driveImport.fileStatuses[f.id] === "error");
            const todoDone = allFiles.length > 0 && allFiles.every((f) => driveImport.fileStatuses[f.id] === "success" || driveImport.fileStatuses[f.id] === "sin_cambios");

            if (todoDone) {
              return (
                <button
                  onClick={async () => {
                    allFiles.forEach((f) => driveImport.resetFile(f.id));
                    await driveImport.importarTodo(ready);
                  }}
                  disabled={driveImport.globalImporting || driveImport.isImporting}
                  className="flex items-center gap-1.5 h-7 px-3 rounded-md border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-600 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <RefreshCw className="w-3 h-3" />
                  Reimportar todo
                </button>
              );
            }

            return hayPendientes ? (
              <button
                onClick={() => driveImport.importarTodo(ready)}
                disabled={driveImport.globalImporting || driveImport.isImporting}
                className="flex items-center gap-1.5 h-7 px-3 rounded-md border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-600 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {driveImport.globalImporting ? (
                  <Spinner size="sm" />
                ) : (
                  <CloudDownload className="w-3.5 h-3.5" />
                )}
                {driveImport.globalImporting ? "Importando…" : "Importar todo"}
              </button>
            ) : null;
          })()}
          <button
            onClick={loadFiles}
            disabled={driveImport.isImporting || driveImport.globalImporting}
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
            fileStatuses={driveImport.fileStatuses}
            fileReports={driveImport.fileReports}
            fileErrors={driveImport.fileErrors}
            onImportOne={driveImport.importOneFile}
            onImportAll={driveImport.importAllFiles}
            globalImporting={driveImport.globalImporting}
            onResetFile={driveImport.resetFile}
          />
        </div>
      )}

      {/* Carpetas PDV */}
      {ready && ready.folders.some((f) => f.localId) && (
        <span className="text-xs font-medium uppercase tracking-widest text-zinc-400 dark:text-zinc-500">
          Transaccionales
        </span>
      )}
      {/* Las carpetas de locales no reconocidos (otras organizaciones, ej. Palermo / Nuñez) no se muestran (Diego, 24/10). */}
      {ready?.folders.filter((folder) => folder.localId).map((folder) => {
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
            fileStatuses={driveImport.fileStatuses}
            fileReports={driveImport.fileReports}
            fileErrors={driveImport.fileErrors}
            onImportOne={driveImport.importOneFile}
            onImportAll={driveImport.importAllFiles}
            blocked={driveImport.maestrosLoaded !== true || !folder.localId}
            blockedTitle={!folder.localId
              ? "Local no reconocido — corregí el nombre de la carpeta en Drive"
              : "Importá los maestros primero"}
            globalImporting={driveImport.globalImporting}
            onResetFile={driveImport.resetFile}
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
