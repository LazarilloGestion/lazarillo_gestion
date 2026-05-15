"use client";

import { useState, useRef, useEffect } from "react";
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
import { Upload, FileSpreadsheet, CheckCircle2, AlertCircle, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ETLReport } from "@/lib/etl/types";

type UploadState =
  | { status: "idle" }
  | { status: "uploading" }
  | { status: "success"; report: ETLReport }
  | { status: "error"; message: string };

interface PuntoDeVenta {
  id: number;
  nombre: string;
}

interface Local {
  id: number;
  nombre: string;
  puntosDeVenta: PuntoDeVenta[];
}

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

export default function ImportarPage() {
  const [state, setState] = useState<UploadState>({ status: "idle" });
  const [locales, setLocales] = useState<Local[]>([]);
  const [localId, setLocalId] = useState<string>("");
  const [puntoDeVentaId, setPuntoDeVentaId] = useState<string>("");
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/locales")
      .then((r) => r.json())
      .then((data: Local[]) => setLocales(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  const puntosDeVenta =
    locales.find((l) => String(l.id) === localId)?.puntosDeVenta ?? [];

  function pickFile(file: File) {
    setSelectedFile(file);
    setState({ status: "idle" });
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) pickFile(file);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selectedFile) return;

    setState({ status: "uploading" });

    const body = new FormData();
    body.append("file", selectedFile);
    if (localId) body.append("localId", localId);
    if (puntoDeVentaId) body.append("puntoDeVentaId", puntoDeVentaId);

    try {
      const res = await fetch("/api/etl/upload", { method: "POST", body });
      const json = await res.json();
      if (!res.ok) {
        setState({ status: "error", message: json.error ?? "Error desconocido" });
      } else {
        setState({ status: "success", report: json as ETLReport });
      }
    } catch {
      setState({ status: "error", message: "Error de red al subir el archivo" });
    }
  }

  return (
    <div className="max-w-2xl mx-auto py-10 px-6 flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Importar datos</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Subí un archivo Excel exportado del ERP. El tipo se detecta automáticamente.
        </p>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30 px-4 py-3 text-xs text-blue-700 dark:text-blue-400">
        <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <span>
          <strong>Orden maestros:</strong> Rubros Concepto Caja → Rubros Artículo → Subrubros Artículo → Conceptos Caja → Artículos → Proveedores
        </span>
      </div>

      <Card>
        <CardContent className="pt-5 flex flex-col gap-5">
          {locales.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">Local <span className="text-muted-foreground font-normal">(archivos transaccionales)</span></label>
              <div className="flex gap-2">
                <Select
                  value={localId}
                  onValueChange={(v) => { setLocalId(v); setPuntoDeVentaId(""); }}
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Sin local" />
                  </SelectTrigger>
                  <SelectContent>
                    {locales.map((l) => (
                      <SelectItem key={l.id} value={String(l.id)}>
                        {l.nombre}
                      </SelectItem>
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
                        <SelectItem key={p.id} value={String(p.id)}>
                          {p.nombre}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div
              className={cn(
                "relative flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors cursor-pointer",
                dragOver
                  ? "border-primary bg-primary/5"
                  : selectedFile
                  ? "border-green-400 bg-green-50 dark:bg-green-950/20"
                  : "border-muted-foreground/25 hover:border-muted-foreground/50 hover:bg-muted/30"
              )}
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
            >
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,.xls"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) pickFile(f);
                }}
              />
              {selectedFile ? (
                <>
                  <FileSpreadsheet className="w-8 h-8 text-green-500" />
                  <div>
                    <p className="text-sm font-medium">{selectedFile.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {(selectedFile.size / 1024).toFixed(0)} KB · Click para cambiar
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <Upload className="w-8 h-8 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Arrastrá o hacé click para seleccionar</p>
                    <p className="text-xs text-muted-foreground mt-0.5">.xlsx o .xls</p>
                  </div>
                </>
              )}
            </div>

            <Button
              type="submit"
              disabled={!selectedFile || state.status === "uploading"}
              className="w-full"
            >
              {state.status === "uploading" ? "Procesando..." : "Importar archivo"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {state.status === "success" && <ReportCard report={state.report} />}

      {state.status === "error" && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          {state.message}
        </div>
      )}
    </div>
  );
}

function ReportCard({ report }: { report: ETLReport }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-green-500" />
          Importación completada
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2 text-sm">
          <span className="text-muted-foreground">Tipo:</span>
          <strong>{FILE_TYPE_LABELS[report.fileType] ?? report.fileType}</strong>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">{report.totalRows} filas</span>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">{report.durationMs}ms</span>
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
