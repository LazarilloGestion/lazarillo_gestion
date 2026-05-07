"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ETLReport } from "@/lib/etl/types";

type UploadState =
  | { status: "idle" }
  | { status: "uploading" }
  | { status: "success"; report: ETLReport }
  | { status: "error"; message: string };

const FILE_TYPE_LABELS: Record<string, string> = {
  rubrosConceptoCaja: "Rubros Concepto Caja",
  rubrosArticulo: "Rubros Artículo",
  subrubrosArticulo: "Subrubros Artículo",
  conceptosCaja: "Conceptos Caja",
  articulos: "Artículos",
  proveedores: "Proveedores",
};

export default function ImportarPage() {
  const [state, setState] = useState<UploadState>({ status: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const file = inputRef.current?.files?.[0];
    if (!file) return;

    setState({ status: "uploading" });

    const body = new FormData();
    body.append("file", file);

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
    <div className="max-w-xl mx-auto py-12 px-4 flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Importar maestros</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Subí un archivo Excel exportado del ERP. El tipo se detecta automáticamente.
        </p>
      </div>

      <Card>
        <CardContent className="pt-4 flex flex-col gap-4">
          <div className="rounded-md border border-muted bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <strong>Orden de carga recomendado:</strong> Rubros Concepto Caja → Rubros
            Artículo → Subrubros Artículo → Conceptos Caja → Artículos → Proveedores
          </div>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls"
              className="text-sm"
              onChange={() => setState({ status: "idle" })}
            />
            <Button type="submit" disabled={state.status === "uploading"}>
              {state.status === "uploading" ? "Procesando..." : "Importar"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {state.status === "success" && <ReportCard report={state.report} />}

      {state.status === "error" && (
        <Card>
          <CardContent className="pt-4">
            <p className="text-destructive text-sm">{state.message}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ReportCard({ report }: { report: ETLReport }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Resultado</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Tipo detectado: <strong>{FILE_TYPE_LABELS[report.fileType] ?? report.fileType}</strong>
          {" · "}
          {report.totalRows} filas · {report.durationMs}ms
        </p>
        <div className="flex gap-2 flex-wrap">
          <Badge>{report.created} creados</Badge>
          <Badge variant="secondary">{report.updated} actualizados</Badge>
          <Badge variant="outline">{report.skipped} omitidos</Badge>
          {report.errors.length > 0 && (
            <Badge variant="destructive">{report.errors.length} errores</Badge>
          )}
        </div>
        {report.storagePath && (
          <p className="text-xs text-muted-foreground">
            Archivo guardado: <code>{report.storagePath}</code>
          </p>
        )}
        {report.errors.length > 0 && (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer hover:text-foreground">
              Ver errores ({report.errors.length})
            </summary>
            <ul className="mt-2 space-y-1 max-h-48 overflow-y-auto">
              {report.errors.map((e, i) => (
                <li key={i}>
                  Fila {e.rowIndex + 1} (codigo:{" "}
                  {String(e.rawCodigo ?? "?")}): {e.message}
                </li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
