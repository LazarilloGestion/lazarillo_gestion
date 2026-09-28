"use client";

import { useEffect, useState } from "react";
import { notify } from "@/lib/toast";
import { useFetchQuery } from "@/hooks/use-fetch-query";
import type { ETLReport } from "@/lib/etl/types";
import type { DriveFile } from "@/lib/drive/types";
import { parseImportResponse } from "./parse-import-response";
import { chunk } from "@/lib/chunk";

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

  const CHUNK_SIZE = 5;

  // Se particiona en tandas de CHUNK_SIZE en vez de mandar toda la carpeta en un
  // solo POST — una carpeta con muchos archivos (ej. Ramos Mejía, 36 tras sumar
  // años homologados el 27/28-sep-2026) podía superar el maxDuration=60 de
  // app/api/etl/drive-import/route.ts, cortando la respuesta después de que el
  // import ya había commiteado todo en la base (confirmado: "Vercel Runtime
  // Timeout Error: Task timed out after 60 seconds" — ver
  // docs/superpowers/specs/2026-09-28-chunking-import-drive-design.md).
  // linkDetalleCompras/sincronizarAperturaSiCorresponde corren una vez por tanda
  // (no acumulados hasta el final de la carpeta) — son idempotentes y operan
  // sobre todo el local en la base, no sobre "esta request", así que repetirlos
  // más seguido es seguro.
  //
  // Si una tanda falla (excepción real de runETL, o error de red), las tandas
  // siguientes de esa carpeta no se intentan — mismo comportamiento que ya existía
  // a nivel carpeta completa, ahora a nivel tanda.
  async function importFiles(files: DriveFile[], localId?: number, puntoDeVentaId?: number): Promise<{ errors: number; unsupported: number; total: number; records: number }> {
    if (files.length === 0) return { errors: 0, unsupported: 0, total: 0, records: 0 };

    setFileStatuses((s) => {
      const n = { ...s };
      for (const f of files) n[f.id] = "importing";
      return n;
    });

    let totalErrors = 0;
    let totalUnsupported = 0;
    let totalRecords = 0;
    let aborted = false;

    for (const batch of chunk(files, CHUNK_SIZE)) {
      if (aborted) {
        const notAttempted: FileStates = {};
        const notAttemptedErrors: FileErrors = {};
        for (const f of batch) {
          notAttempted[f.id] = "error";
          notAttemptedErrors[f.id] = "No se llegó a procesar: otra tanda del mismo lote falló antes.";
        }
        totalErrors += batch.length;
        setFileStatuses((s) => ({ ...s, ...notAttempted }));
        setFileErrors((s) => ({ ...s, ...notAttemptedErrors }));
        continue;
      }

      let finalStatuses: FileStates = {};
      let finalErrors: FileErrors = {};
      let finalReports: Record<string, ETLReport> = {};
      let chunkFailed = false;

      try {
        const res = await fetch("/api/etl/drive-import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            files: batch.map((f) => ({ file_id: f.id, file_name: f.name })),
            local_id: localId,
            punto_de_venta_id: puntoDeVentaId,
          }),
        });
        const json = await res.json();
        notificarApertura(json.apertura);

        const parsed = parseImportResponse(batch, res.ok, json);
        finalStatuses = parsed.statuses;
        finalErrors = parsed.errors;
        finalReports = parsed.reports;
        totalErrors += parsed.errorCount;
        totalUnsupported += parsed.unsupportedCount;
        totalRecords += parsed.recordCount;
        if (!res.ok) chunkFailed = true;
      } catch {
        for (const f of batch) {
          finalStatuses[f.id] = "error";
          finalErrors[f.id] = "Error de red";
        }
        totalErrors += batch.length;
        chunkFailed = true;
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

      if (chunkFailed) aborted = true;
    }

    return { errors: totalErrors, unsupported: totalUnsupported, total: files.length, records: totalRecords };
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
