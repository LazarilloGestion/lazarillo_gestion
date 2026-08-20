"use client";

import { useEffect, useState } from "react";
import { notify } from "@/lib/toast";
import { useFetchQuery } from "@/hooks/use-fetch-query";
import type { ETLReport } from "@/lib/etl/types";
import type { DriveFile } from "@/lib/drive/types";

export type FileImportStatus = "idle" | "importing" | "success" | "error";
export type FileStates = Record<string, FileImportStatus>;
export type FileReports = Record<string, ETLReport[]>;
export type FileErrors = Record<string, string>;

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
      } else if (json && Array.isArray(json.reports)) {
        const reports = json.reports as ETLReport[];
        setFileStatuses((s) => ({ ...s, [file.id]: "success" }));
        setFileReports((s) => ({ ...s, [file.id]: reports }));
        const erroresApertura: string[] = json.apertura?.errores ?? [];
        if (erroresApertura.length > 0) {
          notify.aperturaSincronizacionConErrores(erroresApertura.length);
        }
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
    maestrosQuery.refetch().catch((err) => console.error("[importar] no se pudo refrescar maestros-status tras el import", err));
    return { errors, total: files.length, records };
  }

  async function importarTodo(ready: { maestros: DriveFile[]; folders: { files: DriveFile[]; localId: number | null; puntoDeVentaId: number | null }[] }) {
    setGlobalImporting(true);
    let totalFiles = 0;
    let totalErrors = 0;
    let totalRecords = 0;
    let foldersBlocked = false;
    let skippedFolders = 0;
    try {
      if (ready.maestros.length > 0) {
        const r = await importAllFiles(ready.maestros);
        totalFiles += r.total;
        totalErrors += r.errors;
        totalRecords += r.records;
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
          totalRecords += r.records;
        }
      }
    } finally {
      setGlobalImporting(false);
      if (foldersBlocked) {
        notify.maestrosNoCargados(totalFiles);
      } else {
        if (skippedFolders > 0) notify.localNoReconocido(skippedFolders);
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
