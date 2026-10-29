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
import { revisarHuerfanas } from "./huerfanas";
import { aplicarConceptosEmpleado } from "@/lib/empleados/concepto-fijo-db";

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
  if (huboComprasTocadas) {
    // Concepto fijo por empleado (Diego 29/10/2026) antes de la apertura.
    await aplicarConceptosEmpleado().catch((err: unknown) => console.error("[render] concepto fijo", err));
    await sincronizarTrasImport(getEtlClient(), comprasModificadas);
  }
}

// Corrida completa: todo lo pendiente, con tope de tiempo. onItem informa el
// avance (lo usa la corrida en el servidor para que la pantalla lo muestre).
export async function sincronizarTodo(opts: {
  presupuestoMs: number;
  triggeredBy?: string | null;
  onInicio?: (total: number) => Promise<void>;
  onItem?: (it: ItemRender, r: ResultadoItem | null, hechos: number) => Promise<void>;
}) {
  const inicio = Date.now();
  const items = await listarItems();
  await opts.onInicio?.(items.length);
  const resultados: ResultadoItem[] = [];
  const reportsPorLocal = new Map<number, ETLReport[]>();
  let pendientes = 0;
  let hechos = 0;
  for (const it of items) {
    if (Date.now() - inicio > opts.presupuestoMs) { pendientes++; continue; }
    await opts.onItem?.(it, null, hechos).catch(() => {});
    const r = await sincronizarItem(it, { triggeredBy: opts.triggeredBy });
    resultados.push(r);
    hechos++;
    await opts.onItem?.(it, r, hechos).catch(() => {});
    if ("report" in r && it.localId) reportsPorLocal.set(it.localId, [...(reportsPorLocal.get(it.localId) ?? []), r.report]);
  }
  for (const [localId, reports] of reportsPorLocal) {
    try { await finalizarLocal(localId, reports); } catch (e) { console.error("[render] finalizar", localId, e); }
  }
  // Compras que MaxiRest ya no tiene (versiones viejas de gastos editados), por cada PDV cuyo
  // 14 se leyó en esta corrida — con la foto completa de Render (ver lib/render/huerfanas.ts).
  const leidos = new Set(resultados.filter((r) => "report" in r).map((r) => r.id));
  const porPdv = new Map<string, ItemRender[]>();
  for (const it of items) if (it.fileType === "compras" && it.puntoDeVentaId) porPdv.set(`${it.esquema}|${it.pdv}`, [...(porPdv.get(`${it.esquema}|${it.pdv}`) ?? []), it]);
  for (const its of porPdv.values()) {
    if (!its.some((it) => leidos.has(it.id)) || Date.now() - inicio > opts.presupuestoMs) continue;
    try {
      const r = await revisarHuerfanas({ esquema: its[0].esquema, pdv: its[0].pdv, puntoDeVentaId: its[0].puntoDeVentaId, tablas: its.map((it) => it.tabla) });
      if (r.marcadas || r.restauradas) console.log("[render] huérfanas", its[0].pdv, r);
    } catch (e) { console.error("[render] huérfanas", its[0].pdv, e); }
  }
  return { resultados, pendientes };
}

// ── Corrida en el servidor (botón "Actualizar ahora" y cron) ──────────────────
// Una sola a la vez: si hay una corriendo hace menos de 6 minutos (el tope de la
// función es 5), se devuelve esa. El avance queda en render_corridas para que la
// pantalla lo muestre aunque el usuario cierre la página (Diego, 26/10/2026).
const VIGENCIA_CANDADO_MS = 6 * 60_000;

export type ResultadoCorto = "sin_cambios" | "leido" | `error:${string}`;
const corto = (r: ResultadoItem): ResultadoCorto =>
  "sinCambios" in r ? "sin_cambios" : "report" in r ? "leido" : `error:${r.error}`;

export async function corridaEnCurso() {
  return prisma.renderCorrida.findFirst({
    where: { estado: "corriendo", inicio: { gt: new Date(Date.now() - VIGENCIA_CANDADO_MS) } },
    orderBy: { inicio: "desc" },
  });
}

export async function ultimaCorrida() {
  return prisma.renderCorrida.findFirst({ orderBy: { inicio: "desc" } });
}

// Reserva el candado. null si ya hay una corrida en curso.
export async function abrirCorrida(origen: "boton" | "cron"): Promise<number | null> {
  if (await corridaEnCurso()) return null;
  const c = await prisma.renderCorrida.create({ data: { estado: "corriendo", origen, resumen: {} } });
  return c.id;
}

export async function ejecutarCorrida(id: number, triggeredBy: string | null) {
  const resultados: Record<string, ResultadoCorto> = {};
  try {
    const { pendientes } = await sincronizarTodo({
      presupuestoMs: 230_000,
      triggeredBy,
      onInicio: async (total) => { await prisma.renderCorrida.update({ where: { id }, data: { total } }); },
      onItem: async (it, r, hechos) => {
        if (r) resultados[it.id] = corto(r);
        await prisma.renderCorrida.update({
          where: { id },
          data: { hechos, actual: r ? null : `${it.nombre} · ${it.pdv}`, resumen: resultados as unknown as Prisma.InputJsonValue },
        });
      },
    });
    await prisma.renderCorrida.update({
      where: { id },
      data: { estado: "ok", fin: new Date(), actual: null, resumen: { ...resultados, _pendientes: pendientes } as unknown as Prisma.InputJsonValue },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await prisma.renderCorrida.update({
      where: { id },
      data: { estado: "error", fin: new Date(), actual: null, resumen: { ...resultados, _error: msg } as unknown as Prisma.InputJsonValue },
    }).catch(() => {});
  }
}
