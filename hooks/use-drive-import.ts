"use client";

import { useEffect, useState } from "react";
import { notify } from "@/lib/toast";
import { useFetchQuery } from "@/hooks/use-fetch-query";
import type { ETLReport } from "@/lib/etl/types";
import type { DriveFile } from "@/lib/drive/types";
import { parseImportResponse } from "./parse-import-response";

export type FileImportStatus = "idle" | "importing" | "success" | "error" | "unsupported";
export type FileStates = Record<string, FileImportStatus>;
export type FileReports = Record<string, ETLReport[]>;
export type FileErrors = Record<string, string>;

function notificarApertura(apertura: { errores?: string[]; omitidas?: string[] } | null | undefined) {
  const errores = apertura?.errores ?? [];
  const omitidas = apertura?.omitidas ?? [];
  if (errores.length > 0) notify.aperturaSincronizacionConErrores(errores.length);
  if (omitidas.length > 0) notify.aperturaSincronizacionOmitidas(omitidas.length);
}

/**
 * Orquesta el import de archivos de Drive: estado por archivo, importación
 * individual/en lote, y el status de maestros (bloquea transaccionales hasta
 * que los maestros estén cargados).
 */
export function useDriveImport() {
  const maestrosQuery = useFetchQuery<{ loaded: boolean }>(
    ["maestros-status"],
    "/api/etl/maestros-status"
  );
  const maestrosLoaded = maestrosQuery.data?.loaded ?? null;

  const [fileStatuses, setFileStatuses] = useState<FileStates>({});
  const [fileReports, setFileReports] = useState<FileReports>({});
  const [fileErrors, setFileErrors] = useState<FileErrors>({});
  const [globalImporting, setGlobalImporting] = useState(false);

  const isImporting = Object.values(fileStatuses).some((s) => s === "importing");
  const anyImporting = isImporting || globalImporting;

  useEffect(() => {
    if (!anyImporting) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [anyImporting]);

  // Un solo POST con files[] para todo el lote, en vez de uno por archivo —
  // linkDetalleCompras/sincronizarAperturaSiCorresponde en el servidor corren
  // una vez por carpeta en vez de una vez por archivo (hallazgo de
  // eficiencia, code-review 24-ago-2026). La API devuelve `results` con
  // fileId por entrada para poder actualizar el status individual de cada
  // archivo igual que antes, aunque vayan en un solo request.
  //
  // Nota: el servidor corta el batch entero ante el primer archivo que tira
  // excepción (mismo comportamiento que ya tenía /api/etl/drive-import para
  // files[] antes de este cambio) — los archivos del lote que quedaron detrás
  // del que falló no llegan a intentarse en este request, y quedan marcados
  // como tal (no como "success" ni "idle"). Antes, al mandar un POST por
  // archivo, un archivo roto no le impedía al resto del lote intentarse.
  async function importFiles(files: DriveFile[], localId?: number, puntoDeVentaId?: number): Promise<{ errors: number; unsupported: number; total: number; records: number }> {
    if (files.length === 0) return { errors: 0, unsupported: 0, total: 0, records: 0 };

    setFileStatuses((s) => {
      const n = { ...s };
      for (const f of files) n[f.id] = "importing";
      return n;
    });

    let finalStatuses: FileStates = {};
    let finalErrors: FileErrors = {};
    let finalReports: Record<string, ETLReport> = {};
    let errors = 0;
    let unsupported = 0;
    let records = 0;

    try {
      const res = await fetch("/api/etl/drive-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files: files.map((f) => ({ file_id: f.id, file_name: f.name })),
          local_id: localId,
          punto_de_venta_id: puntoDeVentaId,
        }),
      });
      const json = await res.json();
      notificarApertura(json.apertura);

      const parsed = parseImportResponse(files, res.ok, json);
      finalStatuses = parsed.statuses;
      finalErrors = parsed.errors;
      finalReports = parsed.reports;
      errors = parsed.errorCount;
      unsupported = parsed.unsupportedCount;
      records = parsed.recordCount;
    } catch {
      for (const f of files) {
        finalStatuses[f.id] = "error";
        finalErrors[f.id] = "Error de red";
      }
      errors = files.length;
    }

    setFileStatuses((s) => ({ ...s, ...finalStatuses }));
    setFileReports((s) => {
      const n = { ...s };
      for (const [fileId, report] of Object.entries(finalReports)) n[fileId] = [report];
      return n;
    });
    setFileErrors((s) => {
      const n = { ...s };
      for (const [fileId, msg] of Object.entries(finalErrors)) n[fileId] = msg;
      for (const [fileId, status] of Object.entries(finalStatuses)) {
        if (status === "success") delete n[fileId];
      }
      return n;
    });

    return { errors, unsupported, total: files.length, records };
  }

  async function importOneFile(file: DriveFile, localId?: number, puntoDeVentaId?: number): Promise<{ ok: boolean; records: number }> {
    const { errors, records } = await importFiles([file], localId, puntoDeVentaId);
    return { ok: errors === 0, records };
  }

  async function importAllFiles(files: DriveFile[], localId?: number, puntoDeVentaId?: number): Promise<{ errors: number; unsupported: number; total: number; records: number }> {
    const result = await importFiles(files, localId, puntoDeVentaId);
    maestrosQuery.refetch().catch((err) => console.error("[importar] no se pudo refrescar maestros-status tras el import", err));
    return result;
  }

  async function importarTodo(ready: { maestros: DriveFile[]; folders: { files: DriveFile[]; localId: number | null; puntoDeVentaId: number | null }[] }) {
    setGlobalImporting(true);
    let totalFiles = 0;
    let totalErrors = 0;
    let totalUnsupported = 0;
    let totalRecords = 0;
    let foldersBlocked = false;
    let skippedFolders = 0;
    try {
      let maestrosConErrores = false;
      if (ready.maestros.length > 0) {
        const r = await importAllFiles(ready.maestros);
        totalFiles += r.total;
        totalErrors += r.errors;
        totalUnsupported += r.unsupported;
        totalRecords += r.records;
        // Si algún archivo de maestros falló, no seguir con las carpetas transaccionales:
        // podrían quedar referenciando proveedores/rubros/conceptos que este ciclo debía
        // crear o actualizar y no llegó a hacerlo. Un archivo no soportado no cuenta acá —
        // se ignora, no bloquea nada.
        maestrosConErrores = r.errors > 0;
      }
      if (maestrosConErrores) {
        foldersBlocked = true;
        return;
      }
      if (ready.folders.length > 0) {
        const { data } = await maestrosQuery.refetch();
        if (!data?.loaded) {
          foldersBlocked = true;
          return;
        }
        for (const folder of ready.folders) {
          if (!folder.localId) { skippedFolders++; continue; }
          const r = await importAllFiles(folder.files, folder.localId ?? undefined, folder.puntoDeVentaId ?? undefined);
          totalFiles += r.total;
          totalErrors += r.errors;
          totalUnsupported += r.unsupported;
          totalRecords += r.records;
        }
      }
    } finally {
      setGlobalImporting(false);
      if (foldersBlocked) {
        notify.maestrosNoCargados(totalFiles);
      } else {
        if (skippedFolders > 0) notify.localNoReconocido(skippedFolders);
        if (totalUnsupported > 0) notify.archivosNoSoportados(totalUnsupported);
        if (totalFiles > 0) {
          if (totalErrors === 0) {
            notify.importacionCompletada(totalFiles, totalRecords);
          } else {
            notify.importacionConErrores(totalErrors, totalFiles);
          }
        }
      }
    }
  }

  function resetFile(fileId: string) {
    setFileStatuses((s) => { const n = { ...s }; delete n[fileId]; return n; });
    setFileReports((r) => { const n = { ...r }; delete n[fileId]; return n; });
    setFileErrors((e) => { const n = { ...e }; delete n[fileId]; return n; });
  }

  function resetAll() {
    setFileStatuses({});
    setFileReports({});
    setFileErrors({});
  }

  return {
    maestrosLoaded,
    fileStatuses,
    fileReports,
    fileErrors,
    globalImporting,
    isImporting,
    importOneFile,
    importAllFiles,
    importarTodo,
    resetFile,
    resetAll,
  };
}
