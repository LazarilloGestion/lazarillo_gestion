"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  Upload, FileSpreadsheet, CheckCircle2, AlertCircle, X,
  FolderOpen, Folder, RefreshCw, CloudDownload, Settings, SearchX, ChevronDown,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ETLReport } from "@/lib/etl/types";
import type { Local } from "@/lib/types/domain";
import type { DriveFile, DriveConfig, DriveFilesResponse } from "@/lib/drive/types";

// ── tipos ────────────────────────────────────────────────────────────────────

type UploadState =
  | { status: "idle" }
  | { status: "uploading" }
  | { status: "success"; reports: ETLReport[] }
  | { status: "error"; message: string; reports?: ETLReport[] };

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

type Tab = "subir" | "drive";

export default function ImportarPage() {
  const [tab, setTab] = useState<Tab>("drive");

  const [locales, setLocales] = useState<Local[]>([]);
  const [localesLoading, setLocalesLoading] = useState(true);
  const [localId, setLocalId] = useState("");
  const [puntoDeVentaId, setPuntoDeVentaId] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/locales", { signal: controller.signal })
      .then((r) => r.json())
      .then((data: Local[]) => setLocales(Array.isArray(data) ? data : []))
      .catch((err) => { if (err.name !== "AbortError") console.error(err); })
      .finally(() => setLocalesLoading(false));
    return () => controller.abort();
  }, []);

  const puntosDeVenta = locales.find((l) => String(l.id) === localId)?.puntosDeVenta ?? [];

  const localSelect = (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
        Local{" "}
        <span className="normal-case tracking-normal font-normal text-zinc-400 dark:text-zinc-500">
          (archivos transaccionales)
        </span>
      </label>
      <div className="flex gap-2">
        <Select
          value={localId}
          onValueChange={(v) => { setLocalId(v); setPuntoDeVentaId(""); }}
          disabled={localesLoading}
        >
          <SelectTrigger className="flex-1 border-zinc-200 dark:border-zinc-700">
            <SelectValue placeholder={localesLoading ? "Cargando…" : "Sin local"} />
          </SelectTrigger>
          <SelectContent>
            {locales.map((l) => (
              <SelectItem key={l.id} value={String(l.id)}>{l.nombre}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {puntosDeVenta.length > 0 && (
          <Select value={puntoDeVentaId} onValueChange={setPuntoDeVentaId}>
            <SelectTrigger className="flex-1 border-zinc-200 dark:border-zinc-700">
              <SelectValue placeholder="Sin punto de venta" />
            </SelectTrigger>
            <SelectContent>
              {puntosDeVenta.map((p) => (
                <SelectItem key={p.id} value={String(p.id)}>{p.nombre}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    </div>
  );

  return (
    <div className="max-w-2xl mx-auto py-10 px-6 flex flex-col gap-8">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-white">
          Importar datos
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Importá archivos Excel del ERP — desde Google Drive o desde tu computadora.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border border-zinc-200 dark:border-zinc-700 rounded-lg p-1 w-fit bg-zinc-50 dark:bg-zinc-800/50">
        {(["drive", "subir"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "px-4 py-1.5 text-sm font-medium rounded-md transition-all duration-150",
              tab === t
                ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-sm"
                : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
            )}
          >
            {t === "subir" ? "Subir archivo" : "Desde Drive"}
          </button>
        ))}
      </div>

      <div className={tab !== "subir" ? "hidden" : undefined}>
        <SubirTab
          localSelect={localSelect}
          localId={localId}
          puntoDeVentaId={puntoDeVentaId}
        />
      </div>

      <div className={tab !== "drive" ? "hidden" : undefined}>
        <DriveTab />
      </div>
    </div>
  );
}

// ── Tab: Subir archivo ────────────────────────────────────────────────────────

function SubirTab({
  localSelect,
  localId,
  puntoDeVentaId,
}: {
  localSelect: React.ReactNode;
  localId: string;
  puntoDeVentaId: string;
}) {
  const [state, setState] = useState<UploadState>({ status: "idle" });
  const [dragOver, setDragOver] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  function pickFiles(fileList: FileList) {
    const arr = Array.from(fileList);
    if (arr.length > 0) { setSelectedFiles(arr); setState({ status: "idle" }); }
  }

  function removeFile(index: number) {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    if (selectedFiles.length === 0) return;
    setState({ status: "uploading" });
    const body = new FormData();
    for (const f of selectedFiles) body.append("files", f);
    if (localId) body.append("localId", localId);
    if (puntoDeVentaId) body.append("puntoDeVentaId", puntoDeVentaId);
    try {
      const res = await fetch("/api/etl/upload", { method: "POST", body });
      const json = await res.json();
      if (!res.ok) setState({ status: "error", message: json.error ?? "Error desconocido", reports: json.reports });
      else setState({ status: "success", reports: json as ETLReport[] });
    } catch {
      setState({ status: "error", message: "Error de red al subir los archivos" });
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/30 p-5 flex flex-col gap-5">
        {localSelect}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Drop zone */}
          <div
            className={cn(
              "relative flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-12 text-center transition-all duration-150 cursor-pointer",
              dragOver
                ? "border-zinc-400 bg-zinc-50 dark:border-zinc-500 dark:bg-zinc-800"
                : selectedFiles.length > 0
                ? "border-emerald-400 bg-emerald-50/50 dark:border-emerald-600 dark:bg-emerald-950/20"
                : "border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
            )}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files?.length) pickFiles(e.dataTransfer.files); }}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls"
              multiple
              className="sr-only"
              onChange={(e) => { if (e.target.files?.length) pickFiles(e.target.files); }}
            />
            {selectedFiles.length > 0 ? (
              <>
                <div className="w-10 h-10 rounded-lg bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
                  <FileSpreadsheet className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-zinc-900 dark:text-white">
                    {selectedFiles.length === 1 ? selectedFiles[0].name : `${selectedFiles.length} archivos seleccionados`}
                  </p>
                  <p className="text-xs text-zinc-400 mt-0.5">Click para cambiar</p>
                </div>
              </>
            ) : (
              <>
                <div className="w-10 h-10 rounded-lg bg-zinc-100 dark:bg-zinc-700 flex items-center justify-center">
                  <Upload className="w-5 h-5 text-zinc-400 dark:text-zinc-500" />
                </div>
                <div>
                  <p className="text-sm font-medium text-zinc-900 dark:text-white">
                    Arrastrá o hacé click para seleccionar
                  </p>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    .xlsx o .xls · podés subir varios a la vez
                  </p>
                </div>
              </>
            )}
          </div>

          {/* Lista de archivos múltiples */}
          {selectedFiles.length > 1 && (
            <ul className="flex flex-col gap-1">
              {selectedFiles.map((f, i) => (
                <li
                  key={f.name + f.lastModified}
                  className="flex items-center justify-between rounded-md border border-zinc-100 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <FileSpreadsheet className="w-3.5 h-3.5 shrink-0 text-emerald-500" />
                    <span className="text-xs text-zinc-600 dark:text-zinc-300 truncate font-mono">
                      {f.name}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeFile(i)}
                    className="ml-2 shrink-0 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <button
            type="submit"
            disabled={selectedFiles.length === 0 || state.status === "uploading"}
            className="w-full h-10 rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-sm font-medium transition-all duration-150 hover:bg-zinc-700 dark:hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-white focus-visible:ring-offset-2 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {state.status === "uploading" ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Procesando...
              </>
            ) : selectedFiles.length > 1 ? (
              `Importar ${selectedFiles.length} archivos`
            ) : (
              "Importar archivo"
            )}
          </button>
        </form>
      </div>

      {state.status === "success" && (
        <div className="flex flex-col gap-3">
          {state.reports.map((r, i) => <ReportCard key={i} report={r} />)}
        </div>
      )}
      {state.status === "error" && (
        <>
          <div className="flex items-start gap-3 rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 px-4 py-3">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-500" />
            <p className="text-sm text-red-700 dark:text-red-400">{state.message}</p>
          </div>
          {state.reports && state.reports.length > 0 && (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-zinc-400">Archivos procesados antes del error:</p>
              {state.reports.map((r, i) => <ReportCard key={i} report={r} />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Tab: Desde Drive ──────────────────────────────────────────────────────────

function DriveTab() {
  const [config, setConfig] = useState<DriveConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [folderUrl, setFolderUrl] = useState("");
  const [savingConfig, setSavingConfig] = useState(false);
  const [configError, setConfigError] = useState("");

  const [filesState, setFilesState] = useState<DriveFilesState>({ status: "idle" });
  const [maestrosLoaded, setMaestrosLoaded] = useState<boolean>(true);

  const [fileStatuses, setFileStatuses] = useState<FileStates>({});
  const [fileReports, setFileReports] = useState<FileReports>({});
  const [fileErrors, setFileErrors] = useState<FileErrors>({});

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

  useEffect(() => {
    fetch("/api/etl/maestros-status")
      .then((r) => r.json() as Promise<{ loaded: boolean }>)
      .then((d) => setMaestrosLoaded(d.loaded))
      .catch(() => setMaestrosLoaded(true));
  }, []);

  const isImporting = Object.values(fileStatuses).some((s) => s === "importing");

  useEffect(() => {
    if (!isImporting) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isImporting]);

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

  async function importOneFile(file: DriveFile, localId?: number, puntoDeVentaId?: number) {
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
      } else {
        setFileStatuses((s) => ({ ...s, [file.id]: "success" }));
        setFileReports((s) => ({ ...s, [file.id]: json as ETLReport[] }));
      }
    } catch {
      setFileStatuses((s) => ({ ...s, [file.id]: "error" }));
      setFileErrors((s) => ({ ...s, [file.id]: "Error de red" }));
    }
  }

  async function importAllFiles(files: DriveFile[], localId?: number, puntoDeVentaId?: number) {
    for (const file of files) {
      await importOneFile(file, localId, puntoDeVentaId);
    }
    // Re-chequear maestros por si se acaban de importar
    fetch("/api/etl/maestros-status")
      .then((r) => r.json() as Promise<{ loaded: boolean }>)
      .then((d) => setMaestrosLoaded(d.loaded))
      .catch(() => {});
  }

  if (configLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-zinc-400">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  const ready = filesState.status === "ready" ? filesState.data : null;

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

      {/* Botón refrescar */}
      {config?.folder_id && filesState.status !== "loading" && (
        <div className="flex justify-end">
          <button
            onClick={loadFiles}
            disabled={isImporting}
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
            blocked={!maestrosLoaded}
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
  onImportAll,
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
  onImportOne: (file: DriveFile, localId?: number, puntoDeVentaId?: number) => Promise<void>;
  onImportAll: (files: DriveFile[], localId?: number, puntoDeVentaId?: number) => Promise<void>;
  blocked?: boolean;
}) {
  const [batchRunning, setBatchRunning] = useState(false);
  const [collapsed, setCollapsed] = useState(true);

  const pendingFiles = files.filter((f) => !fileStatuses[f.id] || fileStatuses[f.id] === "idle");
  const allDone = files.length > 0 && files.every((f) => fileStatuses[f.id] === "success");
  const folderImporting = files.some((f) => fileStatuses[f.id] === "importing");

  async function handleImportAll() {
    setBatchRunning(true);
    await onImportAll(files, localId, puntoDeVentaId);
    setBatchRunning(false);
  }

  const allReports = files.flatMap((f) => fileReports[f.id] ?? []);

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/30 overflow-hidden">
      {/* Header de carpeta */}
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
              {allDone && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />}
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
          {files.length > 1 && !allDone && !collapsed && (
            <button
              onClick={handleImportAll}
              disabled={batchRunning || pendingFiles.length === 0 || blocked}
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
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-700/50">
              {files.map((file) => {
                const status = fileStatuses[file.id] ?? "idle";
                return (
                  <li key={file.id} className="flex items-center gap-3 px-4 py-3">
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
                        <p className="text-xs text-red-500 mt-0.5">{fileErrors[file.id]}</p>
                      )}
                    </div>
                    {status === "success" ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                    ) : status === "error" ? (
                      <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                    ) : (
                      <button
                        onClick={() => onImportOne(file, localId, puntoDeVentaId)}
                        disabled={status === "importing" || batchRunning || blocked}
                        className="flex items-center gap-1.5 h-7 px-3 rounded-md border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-600 transition-all disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                      >
                        {status === "importing" ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <CloudDownload className="w-3 h-3" />
                        )}
                        {status === "importing" ? "Importando…" : "Importar"}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {allReports.length > 0 && (
            <div className="flex flex-col gap-2 px-4 pb-4 pt-2">
              {allReports.map((r, i) => <ReportCard key={i} report={r} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── ReportCard ────────────────────────────────────────────────────────────────

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

      {report.storagePath && (
        <p className="text-xs text-zinc-400 font-mono truncate">{report.storagePath}</p>
      )}

      {report.errors.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 font-medium transition-colors">
            Ver {report.errors.length} errores
          </summary>
          <ul className="mt-2 space-y-1 max-h-48 overflow-y-auto">
            {report.errors.map((e, i) => (
              <li key={i} className="font-mono text-zinc-500 dark:text-zinc-400">
                Fila {e.rowIndex + 1} · {String(e.rawCodigo ?? "?")} · {e.message}
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
