"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  FolderOpen, RefreshCw, CloudDownload, Settings, SearchX,
} from "lucide-react";
import { cn, fmtARS } from "@/lib/utils";
import type { ETLReport } from "@/lib/etl/types";
import type { Local } from "@/lib/types/domain";
import type { DriveFile, DriveConfig } from "@/lib/drive/types";

// ── tipos ────────────────────────────────────────────────────────────────────

type UploadState =
  | { status: "idle" }
  | { status: "uploading" }
  | { status: "success"; reports: ETLReport[] }
  | { status: "error"; message: string; reports?: ETLReport[] };

type DriveFilesState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; files: DriveFile[] }
  | { status: "error"; message: string };

type DriveImportState =
  | { status: "idle" }
  | { status: "importing"; fileId: string }
  | { status: "success"; fileId: string; reports: ETLReport[] }
  | { status: "error"; fileId: string; message: string };

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

// ── componente principal ──────────────────────────────────────────────────────

type Tab = "subir" | "drive";

export default function ImportarPage() {
  const [tab, setTab] = useState<Tab>("drive");

  // filtros compartidos entre tabs
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
      <label className="text-sm font-medium">
        Local{" "}
        <span className="text-muted-foreground font-normal">(archivos transaccionales)</span>
      </label>
      <div className="flex gap-2">
        <Select
          value={localId}
          onValueChange={(v) => { setLocalId(v); setPuntoDeVentaId(""); }}
          disabled={localesLoading}
        >
          <SelectTrigger className="flex-1">
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
            <SelectTrigger className="flex-1">
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
    <div className="max-w-2xl mx-auto py-10 px-6 flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Importar datos</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Importá archivos Excel del ERP — desde tu computadora o desde Google Drive.
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex border-b gap-1">
        {(["drive", "subir"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "px-4 py-2 text-sm font-medium border-b-2 transition-colors",
              tab === t
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t === "subir" ? "Subir archivo" : "Desde Drive"}
          </button>
        ))}
      </div>

      {tab === "subir" && (
        <SubirTab
          localSelect={localSelect}
          localId={localId}
          puntoDeVentaId={puntoDeVentaId}
        />
      )}

      {tab === "drive" && (
        <DriveTab
          localSelect={localSelect}
          localId={localId}
          puntoDeVentaId={puntoDeVentaId}
        />
      )}
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

  async function handleSubmit(e: React.FormEvent) {
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
    <>
      <Card>
        <CardContent className="pt-5 flex flex-col gap-5">
          {localSelect}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div
              className={cn(
                "relative flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors cursor-pointer",
                dragOver ? "border-primary bg-primary/5"
                  : selectedFiles.length > 0 ? "border-green-400 bg-green-50 dark:bg-green-950/20"
                  : "border-muted-foreground/25 hover:border-muted-foreground/50 hover:bg-muted/30"
              )}
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files?.length) pickFiles(e.dataTransfer.files); }}
            >
              <input ref={inputRef} type="file" accept=".xlsx,.xls" multiple className="sr-only"
                onChange={(e) => { if (e.target.files?.length) pickFiles(e.target.files); }} />
              {selectedFiles.length > 0 ? (
                <>
                  <FileSpreadsheet className="w-8 h-8 text-green-500" />
                  <div>
                    <p className="text-sm font-medium">
                      {selectedFiles.length === 1 ? selectedFiles[0].name : `${selectedFiles.length} archivos seleccionados`}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">Click para cambiar</p>
                  </div>
                </>
              ) : (
                <>
                  <Upload className="w-8 h-8 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Arrastrá o hacé click para seleccionar</p>
                    <p className="text-xs text-muted-foreground mt-0.5">.xlsx o .xls · podés subir varios a la vez</p>
                  </div>
                </>
              )}
            </div>

            {selectedFiles.length > 1 && (
              <ul className="flex flex-col gap-1">
                {selectedFiles.map((f, i) => (
                  <li key={f.name + f.lastModified} className="flex items-center justify-between rounded-md border px-3 py-1.5 text-xs">
                    <span className="truncate text-muted-foreground">{f.name}</span>
                    <button type="button" onClick={() => removeFile(i)} className="ml-2 shrink-0 text-muted-foreground hover:text-foreground">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <Button type="submit" disabled={selectedFiles.length === 0 || state.status === "uploading"} className="w-full">
              {state.status === "uploading" ? "Procesando..."
                : selectedFiles.length > 1 ? `Importar ${selectedFiles.length} archivos`
                : "Importar archivo"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {state.status === "success" && (
        <div className="flex flex-col gap-3">
          {state.reports.map((r, i) => <ReportCard key={i} report={r} />)}
        </div>
      )}
      {state.status === "error" && (
        <>
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            {state.message}
          </div>
          {state.reports && state.reports.length > 0 && (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-muted-foreground">Archivos procesados antes del error:</p>
              {state.reports.map((r, i) => <ReportCard key={i} report={r} />)}
            </div>
          )}
        </>
      )}
    </>
  );
}

// ── Tab: Desde Drive ──────────────────────────────────────────────────────────

function DriveTab({
  localSelect,
  localId,
  puntoDeVentaId,
}: {
  localSelect: React.ReactNode;
  localId: string;
  puntoDeVentaId: string;
}) {
  const [config, setConfig] = useState<DriveConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [folderUrl, setFolderUrl] = useState("");
  const [savingConfig, setSavingConfig] = useState(false);
  const [configError, setConfigError] = useState("");

  const [filesState, setFilesState] = useState<DriveFilesState>({ status: "idle" });
  const [importState, setImportState] = useState<DriveImportState>({ status: "idle" });

  // Cargar config al montar
  useEffect(() => {
    fetch("/api/drive/config")
      .then((r) => { if (!r.ok) throw new Error("Error cargando config"); return r.json(); })
      .then((d: DriveConfig) => setConfig(d))
      .catch(() => setConfig({ folder_id: null, folder_name: null }))
      .finally(() => setConfigLoading(false));
  }, []);

  // Cargar archivos cuando hay carpeta configurada
  const loadFiles = useCallback(() => {
    setFilesState({ status: "loading" });
    setImportState({ status: "idle" });
    fetch("/api/drive/files")
      .then((r) => r.json() as Promise<{ files?: DriveFile[]; error?: string }>)
      .then((d) => {
        if (d.error) setFilesState({ status: "error", message: d.error });
        else setFilesState({ status: "ready", files: d.files ?? [] });
      })
      .catch(() => setFilesState({ status: "error", message: "Error de red" }));
  }, []);

  useEffect(() => {
    if (!configLoading && config?.folder_id) loadFiles();
  }, [configLoading, config?.folder_id, loadFiles]);

  async function saveConfig(e: React.FormEvent) {
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

  async function importFile(file: DriveFile) {
    setImportState({ status: "importing", fileId: file.id });
    try {
      const res = await fetch("/api/etl/drive-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_id: file.id,
          file_name: file.name,
          local_id: localId ? Number(localId) : undefined,
          punto_de_venta_id: puntoDeVentaId ? Number(puntoDeVentaId) : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) setImportState({ status: "error", fileId: file.id, message: json.error ?? "Error" });
      else setImportState({ status: "success", fileId: file.id, reports: json as ETLReport[] });
    } catch {
      setImportState({ status: "error", fileId: file.id, message: "Error de red" });
    }
  }

  // ── render ──

  if (configLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <RefreshCw className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Filtros de local */}
      <Card>
        <CardContent className="pt-5">{localSelect}</CardContent>
      </Card>

      {/* Configuración de carpeta */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <FolderOpen className="w-4 h-4 text-muted-foreground" />
              Carpeta de Drive
            </CardTitle>
            <button
              onClick={() => { setShowSettings((v) => !v); setConfigError(""); }}
              className="text-muted-foreground hover:text-foreground transition-colors"
              title="Configurar carpeta"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </CardHeader>
        <CardContent className="pt-0 flex flex-col gap-3">
          {config?.folder_id ? (
            <p className="text-sm">
              <span className="font-medium">{config.folder_name ?? config.folder_id}</span>
              <span className="ml-2 font-mono text-xs text-muted-foreground">{config.folder_id}</span>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">Sin carpeta configurada</p>
          )}

          {(showSettings || !config?.folder_id) && (
            <form onSubmit={saveConfig} className="flex flex-col gap-2">
              <Input
                placeholder="https://drive.google.com/drive/folders/..."
                value={folderUrl}
                onChange={(e) => setFolderUrl(e.target.value)}
                className="text-sm"
              />
              {configError && (
                <p className="text-xs text-destructive">{configError}</p>
              )}
              <Button type="submit" size="sm" disabled={savingConfig || !folderUrl.trim()}>
                {savingConfig ? "Guardando…" : "Guardar carpeta"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      {/* Lista de archivos */}
      {config?.folder_id && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Archivos disponibles</CardTitle>
              <button
                onClick={loadFiles}
                disabled={filesState.status === "loading"}
                className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
                title="Actualizar lista"
              >
                <RefreshCw className={cn("w-4 h-4", filesState.status === "loading" && "animate-spin")} />
              </button>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {filesState.status === "loading" && (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <RefreshCw className="w-5 h-5 animate-spin" />
              </div>
            )}

            {filesState.status === "error" && (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                {filesState.message}
              </div>
            )}

            {filesState.status === "ready" && filesState.files.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
                <SearchX className="w-7 h-7 opacity-40" />
                <p className="text-sm">No hay archivos Excel en esta carpeta.</p>
              </div>
            )}

            {filesState.status === "ready" && filesState.files.length > 0 && (
              <ul className="flex flex-col divide-y">
                {filesState.files.map((file) => {
                  const isImporting = importState.status === "importing" && importState.fileId === file.id;
                  const isDone = importState.status === "success" && importState.fileId === file.id;
                  const hasFailed = importState.status === "error" && importState.fileId === file.id;

                  return (
                    <li key={file.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                      <FileSpreadsheet className="w-4 h-4 shrink-0 text-green-500" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{file.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(file.modifiedTime).toLocaleDateString("es-AR")}
                          {file.size && ` · ${formatBytes(Number(file.size))}`}
                        </p>
                      </div>
                      {isDone ? (
                        <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
                      ) : hasFailed ? (
                        <AlertCircle className="w-5 h-5 text-destructive shrink-0" />
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => importFile(file)}
                          disabled={isImporting}
                          className="shrink-0 gap-1.5"
                        >
                          {isImporting ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <CloudDownload className="w-3.5 h-3.5" />
                          )}
                          {isImporting ? "Importando…" : "Importar"}
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {/* Resultado de importación */}
      {importState.status === "success" && (
        <div className="flex flex-col gap-3">
          {importState.reports.map((r, i) => <ReportCard key={i} report={r} />)}
        </div>
      )}
      {importState.status === "error" && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          {importState.message}
        </div>
      )}
    </div>
  );
}

// ── componentes compartidos ───────────────────────────────────────────────────

function ReportCard({ report }: { report: ETLReport }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-green-500" />
          {FILE_TYPE_LABELS[report.fileType] ?? report.fileType}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
          <span>{report.totalRows} filas</span>
          <span>·</span>
          <span>{report.durationMs}ms</span>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Badge className="bg-green-100 text-green-700 hover:bg-green-100 dark:bg-green-900 dark:text-green-300">
            {report.created} creados
          </Badge>
          <Badge variant="secondary">{report.updated} actualizados</Badge>
          <Badge variant="outline">{report.skipped} omitidos</Badge>
          {report.errors.length > 0 && (
            <Badge variant="destructive">{report.errors.length} errores</Badge>
          )}
        </div>
        {report.storagePath && (
          <p className="text-xs text-muted-foreground">
            Guardado en: <code className="font-mono">{report.storagePath}</code>
          </p>
        )}
        {report.errors.length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground font-medium">
              Ver {report.errors.length} errores
            </summary>
            <ul className="mt-2 space-y-1 max-h-48 overflow-y-auto text-muted-foreground">
              {report.errors.map((e, i) => (
                <li key={i} className="font-mono">
                  Fila {e.rowIndex + 1} · {String(e.rawCodigo ?? "?")} · {e.message}
                </li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
