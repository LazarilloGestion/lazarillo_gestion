"use client";

import { Fragment, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  MEDIOS_PAGO_INTERNO, aCuenta, contarAntesDelCursor, cursorTrasSignificativos, disponibleOP,
  formatearImporteAR, importeAInput, normalizarReferencia, parsearImporteAR,
  ETIQUETA_MODO, MODOS_RUBRO, numeroOP, porMes, porRubro, saldoMov, type ModoRubro,
  type DeudaConPdv, type MedioPagoInterno, type MovimientoApertura, type PagoInterno,
} from "@/lib/impagas/aperturas";
import { dias, fmtComprobante, fmtFecha, fmtPesos, normalizarBusqueda } from "@/lib/impagas/clasificar";
import { Antiguedad, Boton } from "./ui";

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const nombreMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

// Cómo ve cada rubro el usuario (por proveedor / concepto / empleado), se recuerda en el navegador.
const LS_MODOS = "impagas:modosRubro";
function leerModos(): Record<string, ModoRubro> {
  if (typeof window === "undefined") return {};
  try {
    const v = JSON.parse(localStorage.getItem(LS_MODOS) ?? "{}");
    return v && typeof v === "object" ? v : {};
  } catch { return {}; }
}
const sinEspacios = normalizarBusqueda;

export interface BodyPagoInterno {
  pdvOrigenId: number;
  fecha: string;
  medio?: MedioPagoInterno;
  referencia: string | null;
  importe?: number;
  keys?: string[];
  usarOp?: number; // usar el disponible de esta orden de pago (no crea otra)
}

type ModoForm =
  | { tipo: "libre" }
  | { tipo: "elegidos"; keys: string[]; importe: number; desc: string } // selección (o atajo Saldar), importe editable
  | { tipo: "editar"; pago: PagoInterno };

export type BodyEditarPago = Omit<BodyPagoInterno, "pdvOrigenId" | "keys" | "usarOp" | "medio"> & { importe: number; medio: MedioPagoInterno };

interface Props {
  deuda: DeudaConPdv;
  saldo: number;
  masVieja: string | null;
  origenLabel: string;
  hoy: Date;
  q: string;
  solo60: boolean;
  abiertos: Set<string>;
  toggle: (k: string) => void;
  guardando: boolean;
  onRegistrar: (b: BodyPagoInterno) => Promise<string | null>; // null = ok, si no el error
  onEditar: (id: number, b: BodyEditarPago) => Promise<string | null>;
  onEliminar: (id: number) => void;
}

// Filas del PDV origen dentro de la tabla de Impagas: cabecera con la deuda,
// formulario de pago, pagos registrados y la deuda por mes; dentro de cada mes,
// por rubro (cada rubro por proveedor, concepto o empleado, a elección).
export function FilasDeudaPdv(p: Props) {
  const { deuda, origenLabel, hoy, q, guardando } = p;
  const [form, setForm] = useState<ModoForm | null>(null);
  const [aEliminar, setAEliminar] = useState<number | null>(null);
  // Selección de movimientos pendientes para pagarlos juntos (suma el saldo).
  const [sel, setSel] = useState<Set<string>>(new Set());
  // Nombre de lo elegido cuando vino de un atajo (Saldar / Saldar mes / Saldar todas).
  const [selDesc, setSelDesc] = useState<string | null>(null);
  const k = `PDV${deuda.pdvOrigenId}`;
  const buscando = !!q.trim();
  const coincidePdv = buscando && sinEspacios(origenLabel).includes(sinEspacios(q));
  const filtroMov = (m: MovimientoApertura) =>
    (!p.solo60 || dias(m.fecha, hoy) <= 60) &&
    (!buscando || coincidePdv || sinEspacios(`${m.proveedor}${m.comprobante ?? ""}${m.concepto}`).includes(sinEspacios(q)));
  // El modal solo se abre en el navegador, así que se lee directo al montar.
  const [modos, setModos] = useState<Record<string, ModoRubro>>(leerModos);
  const [menuRubro, setMenuRubro] = useState<string | null>(null);
  const cambiarModo = (rubro: string, modo: ModoRubro) => {
    const n = { ...modos, [rubro]: modo };
    setModos(n);
    setMenuRubro(null);
    try { localStorage.setItem(LS_MODOS, JSON.stringify(n)); } catch { /* sin almacenamiento */ }
  };
  const meses = porMes(deuda.movimientos.filter(filtroMov));
  const abierto = p.abiertos.has(k) || buscando;
  const pendientes = deuda.movimientos.filter((m) => saldoMov(m) > 0.5).length;
  const sobrante = aCuenta(deuda);

  const abrirForm = (m: ModoForm) => { setForm(m); if (!p.abiertos.has(k)) p.toggle(k); };
  const pagoPorId = new Map(deuda.pagos.map((pg) => [pg.id, pg]));
  const opsDisponibles = deuda.pagos.filter((pg) => disponibleOP(pg) > 0.5);

  const pendientesDe = (l: MovimientoApertura[]) => l.filter((m) => saldoMov(m) > 0.5).map((m) => m.key);
  const movPorKey = new Map(deuda.movimientos.map((m) => [m.key, m]));
  const elegidos = [...sel].filter((x) => { const m = movPorKey.get(x); return m && saldoMov(m) > 0.5; });
  const totalElegido = elegidos.reduce((s, x) => s + saldoMov(movPorKey.get(x)!), 0);
  const haySel = elegidos.length > 0;
  const alternar = (keys: string[]) => {
    setForm(null);
    setSelDesc(null);
    setSel((prev) => {
      const n = new Set(prev);
      const todos = keys.every((x) => n.has(x));
      keys.forEach((x) => (todos ? n.delete(x) : n.add(x)));
      return n;
    });
  };
  // Saldar / Saldar mes / Saldar todas son atajos: eligen esos movimientos y
  // abren el mismo pago que la selección múltiple (importe editable).
  const atajo = (keys: string[], desc: string) => {
    setForm(null);
    setSel(new Set(keys));
    setSelDesc(desc);
    if (!p.abiertos.has(k)) p.toggle(k);
  };
  const limpiarSel = () => { setSel(new Set()); setSelDesc(null); };
  // Tilde de un movimiento, un empleado o un mes (todos / algunos / ninguno elegidos).
  const tilde = (keys: string[], titulo: string) => {
    if (!keys.length) return <span className="inline-block w-3.5" />;
    const n = keys.filter((x) => sel.has(x)).length;
    return (
      <input
        type="checkbox"
        title={titulo}
        aria-label={titulo}
        checked={n === keys.length}
        ref={(el) => { if (el) el.indeterminate = n > 0 && n < keys.length; }}
        onClick={(e) => e.stopPropagation()}
        onChange={() => alternar(keys)}
        className="h-3.5 w-3.5 accent-sky-500 cursor-pointer"
      />
    );
  };

  // Cada movimiento pagado muestra su(s) orden(es) de pago; tocando una se edita.
  const chipsOP = (ops: number[] | undefined) => (ops ?? []).map((id) => {
    const pg = pagoPorId.get(id);
    return (
      <button
        key={id}
        type="button"
        title="Ver / editar la orden de pago"
        onClick={(e) => { e.stopPropagation(); if (pg) abrirForm({ tipo: "editar", pago: pg }); }}
        className="ml-1.5 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-sky-50 text-sky-700 hover:bg-sky-100 dark:bg-sky-950/50 dark:text-sky-300"
      >
        {numeroOP(id)}
      </button>
    );
  });

  // Un movimiento: comprobante · fecha · y lo que no dice el grupo (si el grupo
  // es un concepto, el proveedor; si es un proveedor o empleado, el concepto).
  const filaMovimiento = (m: MovimientoApertura, sangria: string, grupoEsConcepto: boolean) => {
    const s = saldoMov(m);
    const ok = s < 0.5;
    return (
      <tr key={m.key} className={cn("border-b border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900", ok && "text-muted-foreground")}>
        <td className={cn("py-2 pr-3", sangria)}>
          <span className="mr-1.5 align-middle">{tilde(ok ? [] : [m.key], "Elegir para pagar")}</span>
          <span className="text-sky-700 dark:text-sky-400 tabular-nums">{m.comprobante ? fmtComprobante(m.comprobante) : "sin comprobante"}</span>
          <span className="text-muted-foreground"> · {fmtFecha(m.fecha)} · </span>
          <span className="font-medium">{grupoEsConcepto ? m.proveedor : m.concepto || "—"}</span>
          <Chip cls="ml-1.5 bg-zinc-100 text-zinc-600">{Math.round(m.porcentaje)}%</Chip>
          {ok ? <Chip cls="ml-1.5 bg-emerald-50 text-emerald-700">saldado</Chip>
            : m.aplicado > 0.5 ? <Chip cls="ml-1.5 bg-amber-50 text-amber-700">parcial · pagado {fmtPesos(m.aplicado)}</Chip> : null}
          {chipsOP(m.ops)}
        </td>
        <td className="py-2 px-3 text-right tabular-nums text-muted-foreground hidden sm:table-cell">{fmtPesos(m.importe)}</td>
        <td className={cn("py-2 px-3 text-right tabular-nums", ok && "line-through")}>{fmtPesos(s)}</td>
        <td className="py-2 px-3"><Antiguedad fecha={m.fecha} hoy={hoy} /></td>
        <td className="py-2 px-3 hidden sm:table-cell">
          {!ok && !haySel && (
            <Boton disabled={guardando} onClick={() => atajo(
              [m.key], m.comprobante ? fmtComprobante(m.comprobante) : `${m.proveedor} · ${m.concepto}`,
            )}>Saldar</Boton>
          )}
        </td>
      </tr>
    );
  };

  return (
    <>
      <tr onClick={() => p.toggle(k)} className="border-b border-sky-100 dark:border-sky-900 cursor-pointer bg-sky-50/70 dark:bg-sky-950/30 hover:bg-sky-50 dark:hover:bg-sky-950/50">
        <td className="py-2.5 px-3">
          <span className="inline-flex items-center gap-1.5 flex-wrap">
            {tilde(pendientesDe(deuda.movimientos), "Elegir toda la deuda")}
            {abierto ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
            <span className="font-semibold">{origenLabel}</span>
            <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold bg-sky-400 text-sky-950">PDV · aperturas</span>
            <span className="text-xs text-muted-foreground">{pendientes}</span>
            {sobrante > 0.5 && (
              <span className="rounded px-1.5 py-0.5 text-[10px] bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300">
                {fmtPesos(sobrante)} a cuenta
              </span>
            )}
          </span>
        </td>
        <td className="hidden sm:table-cell" />
        <td className="py-2.5 px-3 text-right font-semibold tabular-nums">{fmtPesos(p.saldo)}</td>
        <td className="py-2.5 px-3">
          {p.masVieja ? <Antiguedad fecha={p.masVieja} hoy={hoy} /> : <Chip cls="bg-emerald-50 text-emerald-700">al día</Chip>}
        </td>
        <td className="py-2.5 px-3 hidden sm:table-cell">
          {!haySel && <span className="inline-flex gap-1.5">
            <button
              type="button"
              disabled={guardando}
              onClick={(e) => { e.stopPropagation(); abrirForm({ tipo: "libre" }); }}
              className="h-7 px-2.5 rounded-md bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 text-xs whitespace-nowrap disabled:opacity-40"
            >
              Registrar pago
            </button>
            {p.saldo > 0.5 && (
              <Boton disabled={guardando} onClick={() => atajo(pendientesDe(deuda.movimientos), "todo")}>Saldar todas</Boton>
            )}
          </span>}
        </td>
      </tr>

      {abierto && haySel && (
        <FormPago
          key="seleccion"
          sticky
          modo={{
            tipo: "elegidos", keys: elegidos, importe: totalElegido,
            desc: selDesc ?? `${elegidos.length} elegido${elegidos.length === 1 ? "" : "s"}`,
          }}
          ops={opsDisponibles}
          saldo={p.saldo}
          origenLabel={origenLabel}
          guardando={guardando}
          onCancel={limpiarSel}
          onConfirm={async (b) => {
            const err = await p.onRegistrar({ ...b, pdvOrigenId: deuda.pdvOrigenId });
            if (!err) limpiarSel();
            return err;
          }}
        />
      )}

      {form && !haySel && (
        <FormPago
          sticky
          modo={form}
          ops={opsDisponibles}
          saldo={p.saldo}
          origenLabel={origenLabel}
          guardando={guardando}
          onCancel={() => setForm(null)}
          onConfirm={async (b) => {
            const err = form.tipo === "editar"
              ? await p.onEditar(form.pago.id, { ...b, medio: b.medio ?? "Transferencia", importe: b.importe ?? form.pago.importe })
              : await p.onRegistrar({ ...b, pdvOrigenId: deuda.pdvOrigenId });
            if (!err) setForm(null);
            return err;
          }}
        />
      )}

      {abierto && deuda.pagos.length > 0 && !buscando && (
        <>
          <tr className="bg-zinc-100 dark:bg-zinc-800">
            <td colSpan={5} className="py-1.5 pl-10 pr-3 text-[11px] font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-300">
              Órdenes de pago a {origenLabel}
            </td>
          </tr>
          {deuda.pagos.map((pg) => (
            <tr key={`pg${pg.id}`} className="border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/40 text-xs">
              <td className="py-2 pl-10 pr-3">
                <b className="text-sky-700 dark:text-sky-400">{numeroOP(pg.id)}</b> · {fmtFecha(pg.fecha)} · {pg.medio}{pg.referencia ? ` · ID ${pg.referencia}` : ""}
                <span className="text-muted-foreground"> · imputado a {pg.movimientos} movimiento{pg.movimientos === 1 ? "" : "s"}
                  {pg.importe - pg.aplicado > 0.5 ? ` · ${fmtPesos(pg.importe - pg.aplicado)} a cuenta` : ""}</span>
              </td>
              <td className="hidden sm:table-cell" />
              <td className="py-2 px-3 text-right tabular-nums">{fmtPesos(pg.importe)}</td>
              <td />
              <td className="py-2 px-3 hidden sm:table-cell">
                {aEliminar === pg.id ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="text-destructive">¿Eliminar?</span>
                    <Boton disabled={guardando} onClick={() => { setAEliminar(null); p.onEliminar(pg.id); }}>Sí</Boton>
                    <Boton onClick={() => setAEliminar(null)}>No</Boton>
                  </span>
                ) : (
                  <span className="inline-flex gap-1.5">
                    <Boton disabled={guardando} onClick={() => abrirForm({ tipo: "editar", pago: pg })}>Editar</Boton>
                    <Boton disabled={guardando} onClick={() => setAEliminar(pg.id)}>Eliminar</Boton>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </>
      )}

      {abierto && meses.map((mes) => {
        const km = `${k}M${mes.mes}`;
        const abMes = p.abiertos.has(km) || buscando;
        const cerradoMes = mes.saldo < 0.5;
        const pagadoMes = mes.total - mes.saldo;
        const pendMes = pendientesDe(mes.movimientos);
        return (
          <Fragment key={km}>
            <tr onClick={() => p.toggle(km)} className={cn("border-b border-zinc-100 dark:border-zinc-800 cursor-pointer bg-zinc-100/70 dark:bg-zinc-800/60 hover:bg-zinc-100 dark:hover:bg-zinc-800", cerradoMes && "text-muted-foreground")}>
              <td className="py-2 pl-8 pr-3">
                <span className="inline-flex items-center gap-1.5 flex-wrap">
                  {tilde(pendMes, "Elegir todo el mes")}
                  {abMes ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                  <span className="font-semibold">{nombreMes(mes.mes)}</span>
                  <span className="text-xs text-muted-foreground">{mes.movimientos.length} movimientos</span>
                  {cerradoMes ? <Chip cls="bg-emerald-50 text-emerald-700">saldado</Chip>
                    : pagadoMes > 0.5 ? <Chip cls="bg-amber-50 text-amber-700">parcial · pagado {fmtPesos(pagadoMes)}</Chip> : null}
                </span>
              </td>
              <td className="py-2 px-3 text-right tabular-nums text-muted-foreground hidden sm:table-cell">{fmtPesos(mes.total)}</td>
              <td className={cn("py-2 px-3 text-right tabular-nums font-semibold", cerradoMes && "line-through")}>{fmtPesos(mes.saldo)}</td>
              <td className="py-2 px-3"><Antiguedad fecha={`${mes.mes}-01`} hoy={hoy} /></td>
              <td className="py-2 px-3 hidden sm:table-cell">
                {!cerradoMes && !haySel && (
                  <Boton disabled={guardando} onClick={() => atajo(pendMes, nombreMes(mes.mes))}>Saldar mes</Boton>
                )}
              </td>
            </tr>
            {abMes && porRubro(mes.movimientos, modos).map((ru) => {
              const kr = `${km}R${ru.rubro}`;
              const abRub = p.abiertos.has(kr) || buscando;
              const cerrado = ru.saldo < 0.5;
              const pagadoRub = ru.total - ru.saldo;
              const pendRub = pendientesDe(ru.movimientos);
              const masVieja = ru.movimientos.filter((m) => saldoMov(m) > 0.5).at(-1)?.fecha;
              return (
                <Fragment key={kr}>
                  <tr onClick={() => p.toggle(kr)} className={cn("border-b border-zinc-100 dark:border-zinc-800 cursor-pointer bg-zinc-50 dark:bg-zinc-900/60 hover:bg-zinc-100 dark:hover:bg-zinc-800", cerrado && "text-muted-foreground")}>
                    <td className="py-2 pl-12 pr-3">
                      <span className="inline-flex items-center gap-1.5">
                        {tilde(pendRub, "Elegir todo el rubro")}
                        {abRub ? <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" /> : <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />}
                        <span className="inline-block w-52 truncate font-semibold" title={ru.rubro}>{ru.rubro}</span>
                        <span className="relative" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            title="Cómo ver este rubro"
                            onClick={() => setMenuRubro(menuRubro === ru.rubro ? null : ru.rubro)}
                            className="inline-flex w-[6.5rem] items-center justify-between rounded px-1.5 py-0.5 text-[10px] font-semibold bg-white border border-zinc-200 text-zinc-600 hover:border-sky-300 hover:text-sky-700 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-300"
                          >
                            {ETIQUETA_MODO[ru.modo]} <ChevronDown className="w-2.5 h-2.5" />
                          </button>
                          {menuRubro === ru.rubro && (
                            <>
                              <span className="fixed inset-0 z-20" onClick={() => setMenuRubro(null)} />
                              <span className="absolute left-0 top-full mt-1 z-30 flex w-40 flex-col rounded-md border border-zinc-200 bg-white py-1 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                                {MODOS_RUBRO.map((m) => m === "insumo" ? (
                                  <span key={m} className="px-3 py-1.5 text-muted-foreground cursor-not-allowed" title="Próximamente">
                                    {ETIQUETA_MODO[m]} <span className="text-[10px]">· próximamente</span>
                                  </span>
                                ) : (
                                  <button
                                    key={m}
                                    type="button"
                                    onClick={() => cambiarModo(ru.rubro, m)}
                                    className={cn("px-3 py-1.5 text-left hover:bg-sky-50 dark:hover:bg-sky-950/40", ru.modo === m && "font-semibold text-sky-700 dark:text-sky-300")}
                                  >
                                    {ETIQUETA_MODO[m]}
                                  </button>
                                ))}
                              </span>
                            </>
                          )}
                        </span>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">{ru.movimientos.length} mov.</span>
                        {cerrado ? <Chip cls="bg-emerald-50 text-emerald-700">saldado</Chip>
                          : pagadoRub > 0.5 ? <Chip cls="bg-amber-50 text-amber-700 whitespace-nowrap">parcial · pagado {fmtPesos(pagadoRub)}</Chip> : null}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums text-muted-foreground hidden sm:table-cell">{fmtPesos(ru.total)}</td>
                    <td className={cn("py-2 px-3 text-right tabular-nums font-semibold", cerrado && "line-through")}>{fmtPesos(ru.saldo)}</td>
                    <td className="py-2 px-3">{masVieja && <Antiguedad fecha={masVieja} hoy={hoy} />}</td>
                    <td className="py-2 px-3 hidden sm:table-cell">
                      {!cerrado && !haySel && (
                        <Boton disabled={guardando} onClick={() => atajo(pendRub, `${ru.rubro} · ${nombreMes(mes.mes)}`)}>Saldar rubro</Boton>
                      )}
                    </td>
                  </tr>
                  {abRub && ru.grupos.map((g) => {
                    const kg = `${kr}G${g.clave}`;
                    const abG = p.abiertos.has(kg) || buscando;
                    const ok = g.saldo < 0.5;
                    const pendG = pendientesDe(g.movimientos);
                    const viejaG = g.movimientos.filter((m) => saldoMov(m) > 0.5).at(-1)?.fecha;
                    const grupoEsConcepto = !(ru.modo === "proveedor" || (ru.modo === "empleado" && g.esEmpleado));
                    return (
                      <Fragment key={kg}>
                        <tr onClick={() => p.toggle(kg)} className={cn("border-b border-zinc-100 dark:border-zinc-800 cursor-pointer bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800/60", ok && "text-muted-foreground")}>
                          <td className="py-2 pl-16 pr-3">
                            <span className="inline-flex items-center gap-1.5 flex-wrap">
                              {tilde(pendG, "Elegir todo el grupo")}
                              {abG ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                              <span className="font-medium">{g.clave}</span>
                              <span className="text-xs text-muted-foreground">{g.movimientos.length}</span>
                              {ok ? <Chip cls="bg-emerald-50 text-emerald-700">saldado</Chip>
                                : g.aplicado > 0.5 ? <Chip cls="bg-amber-50 text-amber-700">parcial · pagado {fmtPesos(g.aplicado)}</Chip> : null}
                              {chipsOP([...new Set(g.movimientos.flatMap((m) => m.ops ?? []))].sort((a, b) => a - b))}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-right tabular-nums text-muted-foreground hidden sm:table-cell">{fmtPesos(g.total)}</td>
                          <td className={cn("py-2 px-3 text-right tabular-nums", ok && "line-through")}>{fmtPesos(g.saldo)}</td>
                          <td className="py-2 px-3">{viejaG && <Antiguedad fecha={viejaG} hoy={hoy} />}</td>
                          <td className="py-2 px-3 hidden sm:table-cell">
                            {!ok && !haySel && (
                              <Boton disabled={guardando} onClick={() => atajo(pendG, `${g.clave} · ${nombreMes(mes.mes)}`)}>Saldar</Boton>
                            )}
                          </td>
                        </tr>
                        {abG && g.movimientos.map((m) => filaMovimiento(m, "pl-[5.5rem]", grupoEsConcepto))}
                      </Fragment>
                    );
                  })}
                </Fragment>
              );
            })}
          </Fragment>
        );
      })}
    </>
  );
}

function Chip({ cls, children }: { cls: string; children: React.ReactNode }) {
  return <span className={cn("rounded px-1.5 py-0.5 text-[10px] dark:bg-zinc-800 dark:text-zinc-300", cls)}>{children}</span>;
}

function hoyISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Input de importe en formato moneda que no corre el cursor al final al
// reformatear (se puede cambiar un número del medio).
function ImporteInput({ value, onChange, readOnly, className }: {
  value: string; onChange: (v: string) => void; readOnly?: boolean; className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const cursor = useRef<number | null>(null);
  const [tick, setTick] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && cursor.current !== null && document.activeElement === el) {
      const pos = cursorTrasSignificativos(value, cursor.current);
      el.setSelectionRange(pos, pos);
    }
    cursor.current = null;
  }, [value, tick]);
  return (
    <input
      ref={ref}
      value={value}
      readOnly={readOnly}
      inputMode="decimal"
      onChange={(e) => {
        const t = e.target;
        cursor.current = contarAntesDelCursor(t.value, t.selectionStart ?? t.value.length);
        onChange(formatearImporteAR(t.value));
        setTick((n) => n + 1);
      }}
      className={className}
    />
  );
}

function FormPago({ modo, ops, saldo, origenLabel, guardando, sticky, onCancel, onConfirm }: {
  modo: ModoForm; ops: PagoInterno[]; saldo: number; origenLabel: string; guardando: boolean;
  sticky?: boolean; // la selección queda fija arriba mientras se baja por la lista
  onCancel: () => void;
  onConfirm: (b: Omit<BodyPagoInterno, "pdvOrigenId">) => Promise<string | null>;
}) {
  const editando = modo.tipo === "editar";
  const importeBase = modo.tipo === "elegidos" ? modo.importe : modo.tipo === "editar" ? modo.pago.importe : saldo;
  const [importe, setImporte] = useState(importeAInput(importeBase));
  const [fecha, setFecha] = useState(editando ? modo.pago.fecha : hoyISO());
  // Medio: uno de los medios o "op:ID" = usar el disponible de una OP existente.
  const [medio, setMedio] = useState<string>(
    editando && (MEDIOS_PAGO_INTERNO as readonly string[]).includes(modo.pago.medio) ? modo.pago.medio : "Transferencia"
  );
  const [referencia, setReferencia] = useState(editando ? modo.pago.referencia ?? "" : "");
  const [error, setError] = useState<string | null>(null);
  const opElegida = medio.startsWith("op:") ? ops.find((o) => o.id === Number(medio.slice(3))) ?? null : null;
  const disp = opElegida ? disponibleOP(opElegida) : 0;
  // Al tildar o destildar, el importe se rearma con la nueva suma (con una OP
  // como medio, sin pasar su disponible); fecha, medio e ID se conservan.
  const [base, setBase] = useState(importeBase);
  if (base !== importeBase) {
    setBase(importeBase);
    setImporte(importeAInput(opElegida ? Math.min(importeBase, disp) : importeBase));
  }
  const valorActual = parsearImporteAR(importe) ?? 0;

  function cambiarMedio(v: string) {
    setMedio(v);
    const o = v.startsWith("op:") ? ops.find((x) => x.id === Number(v.slice(3))) : null;
    // Con una OP, un importe editable no puede pasar su disponible.
    if (o && valorActual > disponibleOP(o)) setImporte(importeAInput(disponibleOP(o)));
  }

  async function confirmar() {
    setError(null);
    const valor = parsearImporteAR(importe);
    if (!(valor && valor > 0)) { setError("Cargá un importe."); return; }
    const keys = modo.tipo === "elegidos" ? modo.keys : undefined;
    if (opElegida) {
      if (valor! > disp + 0.005) { setError(`${numeroOP(opElegida.id)} tiene ${fmtPesos(disp)} disponibles.`); return; }
      const err = await onConfirm({ fecha, referencia: null, usarOp: opElegida.id, keys, importe: valor! });
      if (err) setError(err);
      return;
    }
    const m = medio as MedioPagoInterno;
    let ref: string | null = null;
    if (m === "Transferencia") {
      ref = normalizarReferencia(referencia);
      if (!ref) { setError("Cargá el ID de la transferencia (letras y números)."); return; }
    }
    const err = await onConfirm({
      fecha, medio: m, referencia: ref, keys, importe: valor!,
    });
    if (err) setError(err);
  }

  const input = "h-8 rounded-md border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-2 text-sm";
  const titulo = modo.tipo === "elegidos" ? `Pago · ${modo.desc}`
    : modo.tipo === "editar" ? `Editar ${numeroOP(modo.pago.id)}` : `Pago a ${origenLabel}`;
  const aCuentaNuevo = modo.tipo === "elegidos" && !opElegida ? valorActual - modo.importe : 0;
  return (
    <tr className="bg-sky-50 dark:bg-sky-950/40 border-b border-sky-200 dark:border-sky-900">
      <td colSpan={5} className={cn("py-3 px-4", sticky && "sticky top-[32px] z-[5] bg-sky-50 dark:bg-sky-950 shadow-[0_2px_6px_rgba(0,0,0,0.08)]")}>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <b>{titulo}</b>
          {modo.tipo === "elegidos" && <span className="tabular-nums text-muted-foreground">Saldo {fmtPesos(modo.importe)}</span>}
          <label className="flex items-center gap-1.5">Importe
            <ImporteInput
              value={importe}
              onChange={setImporte}
              className={cn(input, "w-44 text-right tabular-nums")}
            />
          </label>
          <label className="flex items-center gap-1.5">Medio
            <select value={medio} onChange={(e) => cambiarMedio(e.target.value)} className={input}>
              {MEDIOS_PAGO_INTERNO.map((m) => <option key={m} value={m}>{m}</option>)}
              {!editando && ops.length > 0 && (
                <optgroup label="Usar saldo a cuenta">
                  {ops.map((o) => (
                    <option key={o.id} value={`op:${o.id}`}>{numeroOP(o.id)} · disponible {fmtPesos(disponibleOP(o))}</option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
          {!opElegida && (
            <label className="flex items-center gap-1.5">Fecha
              <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={input} />
            </label>
          )}
          {medio === "Transferencia" && (
            <label className="flex items-center gap-1.5">ID
              <input
                value={referencia}
                onChange={(e) => setReferencia(e.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase())}
                placeholder="ID de la transferencia"
                className={cn(input, "w-64 font-mono")}
              />
            </label>
          )}
          <button
            type="button" disabled={guardando} onClick={confirmar}
            className="h-8 px-3 rounded-md bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 disabled:opacity-40"
          >
            {opElegida ? `Imputar ${numeroOP(opElegida.id)}` : "Confirmar"}
          </button>
          <button type="button" onClick={onCancel} className="h-8 px-3 rounded-md border border-zinc-300 dark:border-zinc-600">{modo.tipo === "elegidos" ? "Limpiar" : "Cancelar"}</button>
        </div>
        <div className="mt-1.5 text-[11px] text-muted-foreground">
          {opElegida
            ? (modo.tipo === "elegidos" && disp + 0.005 < modo.importe
              ? `No crea una OP nueva. ${numeroOP(opElegida.id)} tiene ${fmtPesos(disp)}: salda eso (lo más viejo primero) y el resto queda pendiente.`
              : `No crea una OP nueva: se imputa el disponible de ${numeroOP(opElegida.id)} (fecha e ID son los de esa OP).`)
            : modo.tipo === "elegidos"
              ? (aCuentaNuevo > 0.5
                ? `Salda todo lo elegido y ${fmtPesos(aCuentaNuevo)} quedan a cuenta, sin asociar.`
                : "Se imputa a lo elegido, del más viejo al más nuevo; si ponés menos, el último queda parcial; si ponés más, el excedente queda a cuenta.")
            : modo.tipo === "editar" ? "Si cambiás el importe se vuelve a imputar: primero a los mismos movimientos, después a lo más viejo; lo que sobra queda a cuenta. Para deshacerla, Eliminar."
            : "Se aplica a lo más viejo primero; si es menos, el último queda parcial; si es más, queda a cuenta."}
        </div>
        {error && <div className="mt-1.5 text-xs text-destructive">{error}</div>}
      </td>
    </tr>
  );
}
