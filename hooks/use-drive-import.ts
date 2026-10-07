"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { notify } from "@/lib/toast";
import { useFetchQuery } from "@/hooks/use-fetch-query";
import type { ETLReport } from "@/lib/etl/types";
import type { DriveFile } from "@/lib/drive/types";
import { parseImportResponse } from "./parse-import-response";
import { accumulateAperturaInputs } from "./accumulate-apertura-inputs";
import { parseFinalizarResponse } from "./parse-finalizar-response";
import { chunk } from "@/lib/chunk";

// 5 → 3 → 1 el mismo día (28-sep-2026). Con 3 volvió a fallar: ventas corre
// 13-16s POR ARCHIVO (más lento que compras, 5-8s), así que hasta 3 ventas
// pesados en una tanda ya sumaban más de 60s. La razón original para meter
// varios archivos en un mismo request (que linkDetalleCompras/
// sincronizarAperturaSiCorresponde no corrieran una vez por archivo) ya no
// aplica — esas dos corren una sola vez por carpeta vía /finalizar,
// desacopladas de cuántos requests hicieron falta. Batchear más de un
// archivo por request ya no ahorra nada real, solo suma riesgo de que la
// SUMA de varios archivos pesados supere los 60s. Un archivo por request
// (peor caso medido hoy: ~16s, ventas de 15.618 filas) deja margen de sobra
// sin tener que adivinar un número.
const CHUNK_SIZE = 1;

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
  const queryClient = useQueryClient();
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

  // Se particiona en tandas de CHUNK_SIZE en vez de mandar toda la carpeta en un
  // solo POST — una carpeta con muchos archivos (ej. Ramos Mejía, 36 tras sumar
  // años homologados el 27/28-sep-2026) podía superar el maxDuration=60 de
  // app/api/etl/drive-import/route.ts, cortando la respuesta después de que el
  // import ya había commiteado todo en la base (confirmado: "Vercel Runtime
  // Timeout Error: Task timed out after 60 seconds" — ver
  // docs/superpowers/specs/2026-09-28-chunking-import-drive-design.md).
  //
  // linkDetalleCompras/sincronizarAperturaSiCorresponde YA NO corren por tanda —
  // se acumulan acá y se sincronizan una sola vez al final de la carpeta, vía
  // POST /api/etl/drive-import/finalizar. Correrlos por tanda parecía seguro
  // (son idempotentes) pero no era gratis: reaplicarReglasActivas reescanea
  // TODAS las compras esDistribuido=false contra TODAS las reglas activas en
  // cada corrida — con Ramos Mejía (139 reglas, ~55.000 compras sin distribuir
  // por el backlog histórico que se está importando) eso multiplicaba el costo
  // por la cantidad de tandas de la carpeta, y una tanda de 5 archivos que
  // antes entraba cómoda en el presupuesto volvió a superar los 60s (segundo
  // timeout real, 28-sep-2026, mismos archivos que minutos antes habían
  // importado bien).
  //
  // Si una tanda falla (excepción real de runETL, o error de red), las tandas
  // siguientes de esa carpeta no se intentan — mismo comportamiento que ya existía
  // a nivel carpeta completa, ahora a nivel tanda. La finalización igual corre al
  // final con lo que sí se llegó a procesar (mismo criterio que ya existía para
  // un fallo a mitad de una sola request, antes de particionar).
  async function importFiles(files: DriveFile[], localId?: number, puntoDeVentaId?: number): Promise<{ errors: number; unsupported: number; total: number; records: number }> {
    if (files.length === 0) return { errors: 0, unsupported: 0, total: 0, records: 0 };

    let totalErrors = 0;
    let totalUnsupported = 0;
    let totalRecords = 0;
    let aborted = false;
    const reportesCompras: ETLReport[] = [];

    // Maestros (localId == null) van siempre en un solo request: el server ordena por
    // dependencia real (getFileOrder, headers del Excel) DENTRO de un request, pero no
    // entre requests separados — particionar acá arriesgaba correr conceptosCaja antes
    // que rubrosConceptoCaja hubiera commiteado, y conceptos-caja.ts pone codRga=null en
    // silencio para códigos que todavía no existen (silent-drop, hallazgo Important de
    // la revisión final de rama). Los maestros son un conjunto chico y fijo de tipos de
    // archivo que nunca causó el timeout original — solo las carpetas transaccionales
    // (años de compras/ventas acumulados) lo hacían, así que solo esas necesitan partirse.
    const batches = localId != null ? chunk(files, CHUNK_SIZE) : [files];

    for (const batch of batches) {
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

      setFileStatuses((s) => {
        const n = { ...s };
        for (const f of batch) n[f.id] = "importing";
        return n;
      });

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

        const parsed = parseImportResponse(batch, res.ok, json);
        finalStatuses = parsed.statuses;
        finalErrors = parsed.errors;
        finalReports = parsed.reports;
        totalErrors += parsed.errorCount;
        totalUnsupported += parsed.unsupportedCount;
        totalRecords += parsed.recordCount;
        if (!res.ok) chunkFailed = true;

        reportesCompras.push(...Object.values(parsed.reports));
      } catch (err) {
        console.error("[useDriveImport] Error de red importando tanda", err);
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

    const { huboComprasTocadas, comprasModificadas } = accumulateAperturaInputs(reportesCompras);
    if (huboComprasTocadas) {
      try {
        const res = await fetch("/api/etl/drive-import/finalizar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            local_id: localId,
            compras_modificadas: comprasModificadas,
            hubo_compras_tocadas: huboComprasTocadas,
          }),
        });
        // Un timeout de Vercel responde con un cuerpo que no es JSON: se parsea
        // aparte para distinguir "no se pudo leer" de un fallo de red.
        const json = await res.json().catch(() => null);
        const resultado = parseFinalizarResponse(res.ok, res.status, json);
        if (resultado.tipo === "fallo") {
          console.error("[useDriveImport] Falló la sincronización de apertura", resultado.motivo);
          notify.aperturaSincronizacionFallida(resultado.motivo);
        } else {
          notificarApertura(resultado.apertura);
        }
      } catch (err) {
        console.error("[useDriveImport] Error finalizando sincronización de apertura", err);
        notify.aperturaSincronizacionFallida(err instanceof Error ? err.message : String(err));
      }
    }

    // Un maestro importado puede haber renombrado un concepto/rubro/proveedor;
    // sin esto el desplegable de edición de Gastos sigue mostrando el nombre
    // viejo hasta que vence el staleTime de 5 min de ["suggestions"].
    await queryClient.invalidateQueries({ queryKey: ["suggestions"] });

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
