import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getEtlClient } from "@/lib/etl/etl-client";
import { runETLFilas } from "@/lib/etl/run-etl";
import { linkDetalleCompras } from "@/lib/etl/link-detalle-compras";
import { sincronizarTrasImport } from "@/lib/apertura/reimportacion";
import { accumulateAperturaInputs } from "@/hooks/accumulate-apertura-inputs";
import type { DbClient, ETLReport } from "@/lib/etl/types";
import { filaDeRender, informeDeTabla } from "./filas";
import { huellaTabla, leerCargas, leerTabla, PDV_MAESTROS } from "./db";

// Un ítem = una tabla de Render para un PDV (ej. i14 2026 del BAR → Ramos · Bar).
export type ItemRender = {
  id: string; // "container.i14_gastos_compras_detallado_2026.BAR"
  esquema: string;
  tabla: string;
  pdv: string;
  nombre: string;
  anio: number | null;
  fileType: ETLReport["fileType"];
  localId: number;
  puntoDeVentaId: number;
  filas: number;
  cargadoEnRender: string;
  bloqueado: string | null;
  ultimo: { estado: string; creadoEn: string; huella: string | null; created: number | null; updated: number | null; errores: number } | null;
};

export type ResultadoItem =
  | { id: string; sinCambios: true }
  | { id: string; report: ETLReport }
  | { id: string; error: string };

const claveLog = (id: string) => `render:${id}`;

// Años que se leen de Render: el actual y el anterior (lo viejo ya está importado
// y el kit solo recarga esos dos).
function aniosVigentes(hoy = new Date()): Set<number> {
  const y = hoy.getUTCFullYear();
  return new Set([y, y - 1]);
}

export async function listarItems(): Promise<ItemRender[]> {
  const origenes = await prisma.renderOrigen.findMany({ where: { activo: true }, orderBy: { id: "asc" } });
  const porEsquema = new Map<string, typeof origenes>();
  for (const o of origenes) porEsquema.set(o.esquema, [...(porEsquema.get(o.esquema) ?? []), o]);
  const anios = aniosVigentes();
  const items: ItemRender[] = [];
  for (const [esquema, origs] of porEsquema) {
    const cargas = await leerCargas(esquema, [...origs.map((o) => o.pdv), PDV_MAESTROS]);
    for (const c of cargas) {
      const inf = informeDeTabla(c.tabla);
      if (!inf || (inf.anio != null && !anios.has(inf.anio))) continue;
      // Maestro de la organización: va con localId/PDV 0 (no es de un PDV).
      if (Boolean(inf.informe.maestro) !== (c.pdv === PDV_MAESTROS)) continue;
      const o = inf.informe.maestro ? { localId: 0, puntoDeVentaId: 0 } : origs.find((x) => x.pdv === c.pdv)!;
      items.push({
        id: `${esquema}.${c.tabla}.${c.pdv}`,
        esquema,
        tabla: c.tabla,
        pdv: c.pdv,
        nombre: inf.informe.nombre + (inf.anio ? ` ${inf.anio}` : ""),
        anio: inf.anio,
        fileType: inf.informe.fileType,
        localId: o.localId,
        puntoDeVentaId: o.puntoDeVentaId,
        filas: c.filas,
        cargadoEnRender: c.cargado,
        bloqueado: inf.informe.requiereOrden && !c.tieneFila ? "Falta que el kit suba el orden de las filas" : null,
        ultimo: null,
      });
    }
  }
  if (items.length) {
    const logs = await prisma.importLog.findMany({
      where: { driveFileId: { in: items.map((i) => claveLog(i.id)) } },
      orderBy: { creadoEn: "desc" },
      select: { driveFileId: true, estado: true, creadoEn: true, driveHuella: true, created: true, updated: true, errors: true },
    });
    for (const it of items) {
      const l = logs.find((x) => x.driveFileId === claveLog(it.id));
      if (l) it.ultimo = {
        estado: l.estado, creadoEn: l.creadoEn.toISOString(), huella: l.driveHuella,
        created: l.created, updated: l.updated, errores: Array.isArray(l.errors) ? l.errors.length : 0,
      };
    }
  }
  // Orden de dependencia: compras → detalle → pagos → nómina → ventas.
  const orden = ["conceptosCaja", "compras", "detalleCompras", "pagos", "nomina", "ventas"];
  return items.sort((a, b) => a.localId - b.localId || a.puntoDeVentaId - b.puntoDeVentaId || orden.indexOf(a.fileType) - orden.indexOf(b.fileType) || (a.anio ?? 0) - (b.anio ?? 0));
}

async function maestrosCargados(): Promise<boolean> {
  const db = getEtlClient();
  const [p, c, a] = await Promise.all([db.proveedor.count(), db.conceptoCaja.count(), db.articulo.count()]);
  return p > 0 && c > 0 && a > 0;
}

export async function sincronizarItem(item: ItemRender, opts: { forzar?: boolean; triggeredBy?: string | null }): Promise<ResultadoItem> {
  if (item.bloqueado) return { id: item.id, error: item.bloqueado };
  if (!(await maestrosCargados())) return { id: item.id, error: "Importá los maestros antes (desde Drive)." };

  const huella = await huellaTabla(item.esquema, item.tabla, item.pdv);
  if (!opts.forzar) {
    const ultimo = await prisma.importLog.findFirst({
      where: { driveFileId: claveLog(item.id) },
      orderBy: { creadoEn: "desc" },
      select: { estado: true, driveHuella: true },
    });
    if (ultimo?.estado === "ok" && ultimo.driveHuella === huella) return { id: item.id, sinCambios: true };
  }

  // Conceptos nuevos de un rubro que el Panel todavía no tiene: el rubro se crea
  // con el nombre que trae el maestro 17 (Render no tiene el maestro 11).
  if (item.fileType === "conceptosCaja") {
    try {
      const { filas } = await leerTabla(item.esquema, item.tabla, item.pdv, false);
      const rubros = new Map<string, string>();
      for (const f of filas) {
        const cod = f.cod_rga != null ? String(f.cod_rga) : null;
        if (cod && Number(cod) > 0 && f.rubro) rubros.set(cod, String(f.rubro).trim());
      }
      if (rubros.size) {
        await prisma.rubroConceptoCaja.createMany({
          data: [...rubros].map(([codigo, nombre]) => ({ codigo, nombre })),
          skipDuplicates: true,
        });
      }
    } catch (e) {
      console.error("[render] rubros de conceptos", e);
    }
  }

  const base = {
    batchId: crypto.randomUUID(),
    fileType: item.fileType,
    fileName: `Render · ${item.nombre} · ${item.pdv}`,
    localId: item.localId || null,
    puntoDeVentaId: item.puntoDeVentaId || null,
    triggeredBy: opts.triggeredBy ?? "render",
    driveFileId: claveLog(item.id),
    driveHuella: huella,
  };
  let report: ETLReport;
  try {
    const { filas, tipos } = await leerTabla(item.esquema, item.tabla, item.pdv, item.fileType === "ventas");
    const rows = filas.map((f) => filaDeRender(f, tipos));
    const ctx = item.localId ? { localId: item.localId, puntoDeVentaId: item.puntoDeVentaId } : {};
    report = await runETLFilas(item.fileType, rows, ctx, getEtlClient() as unknown as DbClient);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    await prisma.importLog.create({ data: { ...base, estado: "error", errorMessage: message } }).catch(() => {});
    return { id: item.id, error: message };
  }
  await prisma.importLog.create({
    data: {
      ...base,
      estado: "ok",
      totalRows: report.totalRows,
      created: report.created,
      updated: report.updated,
      skipped: report.skipped,
      errors: report.errors.slice(0, 500) as unknown as Prisma.InputJsonValue,
      skippedRows: report.skippedRows?.slice(0, 500) as unknown as Prisma.InputJsonValue | undefined,
      durationMs: report.durationMs,
    },
  }).catch((e) => console.error("[render] no se pudo loguear", item.id, e));
  return { id: item.id, report };
}

// Cierre por local, igual que /api/etl/drive-import/finalizar: vincula el detalle
// con las compras y reaplica la apertura de gastos si cambiaron compras.
export async function finalizarLocal(localId: number, reports: ETLReport[]): Promise<void> {
  await linkDetalleCompras(getEtlClient() as unknown as DbClient, localId);
  const { huboComprasTocadas, comprasModificadas } = accumulateAperturaInputs(reports);
  if (huboComprasTocadas) await sincronizarTrasImport(getEtlClient(), comprasModificadas);
}

// Corrida completa (la usa el cron diario): todo lo pendiente, con tope de tiempo.
export async function sincronizarTodo(opts: { presupuestoMs: number; triggeredBy?: string | null }) {
  const inicio = Date.now();
  const items = await listarItems();
  const resultados: ResultadoItem[] = [];
  const reportsPorLocal = new Map<number, ETLReport[]>();
  let pendientes = 0;
  for (const it of items) {
    if (Date.now() - inicio > opts.presupuestoMs) { pendientes++; continue; }
    const r = await sincronizarItem(it, { triggeredBy: opts.triggeredBy });
    resultados.push(r);
    if ("report" in r && it.localId) reportsPorLocal.set(it.localId, [...(reportsPorLocal.get(it.localId) ?? []), r.report]);
  }
  for (const [localId, reports] of reportsPorLocal) {
    try { await finalizarLocal(localId, reports); } catch (e) { console.error("[render] finalizar", localId, e); }
  }
  return { resultados, pendientes };
}
