"use client";

import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  MEDIOS_PAGO_INTERNO, aCuenta, formatearImporteAR, importeAInput, normalizarReferencia, parsearImporteAR,
  agruparEmpleados, porMes, saldoMov, type DeudaConPdv, type MedioPagoInterno, type MovimientoApertura,
} from "@/lib/impagas/aperturas";
import { dias, fmtComprobante, fmtFecha, fmtPesos, normalizarBusqueda } from "@/lib/impagas/clasificar";
import { Antiguedad, Boton } from "./ui";

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const nombreMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const sinEspacios = normalizarBusqueda;

export interface BodyPagoInterno {
  pdvOrigenId: number;
  fecha: string;
  medio: MedioPagoInterno;
  referencia: string | null;
  importe?: number;
  keys?: string[];
}

type ModoForm = { tipo: "libre" } | { tipo: "saldar"; keys: string[]; importe: number; desc: string };

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
  onAnular: (id: number) => void;
}

// Filas del PDV origen dentro de la tabla de Impagas: cabecera con la deuda,
// formulario de pago, pagos registrados, meses y movimientos.
export function FilasDeudaPdv(p: Props) {
  const { deuda, origenLabel, hoy, q, guardando } = p;
  const [form, setForm] = useState<ModoForm | null>(null);
  const k = `PDV${deuda.pdvOrigenId}`;
  const buscando = !!q.trim();
  const coincidePdv = buscando && sinEspacios(origenLabel).includes(sinEspacios(q));
  const filtroMov = (m: MovimientoApertura) =>
    (!p.solo60 || dias(m.fecha, hoy) <= 60) &&
    (!buscando || coincidePdv || sinEspacios(`${m.proveedor}${m.comprobante ?? ""}${m.concepto}`).includes(sinEspacios(q)));
  const meses = porMes(deuda.movimientos.filter(filtroMov));
  const abierto = p.abiertos.has(k) || buscando;
  const pendientes = deuda.movimientos.filter((m) => saldoMov(m) > 0.5).length;
  const sobrante = aCuenta(deuda);

  const abrirForm = (m: ModoForm) => { setForm(m); if (!p.abiertos.has(k)) p.toggle(k); };

  // Un movimiento suelto; dentro de un empleado se muestra solo el concepto.
  const filaMovimiento = (m: MovimientoApertura, sangria: string, deEmpleado = false) => {
    const s = saldoMov(m);
    const ok = s < 0.5;
    return (
      <tr key={m.key} className={cn("border-b border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900", ok && "text-muted-foreground")}>
        <td className={cn("py-2 pr-3", sangria)}>
          {deEmpleado ? (
            <span>{m.concepto || "—"}<span className="text-muted-foreground"> · {fmtFecha(m.fecha)}</span></span>
          ) : (
            <>
              <span className="text-sky-700 dark:text-sky-400 tabular-nums">{m.comprobante ? fmtComprobante(m.comprobante) : "sin comprobante"}</span>
              <span className="text-muted-foreground"> · {fmtFecha(m.fecha)} · </span>
              <span className="font-medium">{m.proveedor}</span>
            </>
          )}
          <Chip cls="ml-1.5 bg-zinc-100 text-zinc-600">{Math.round(m.porcentaje)}%</Chip>
          {ok ? <Chip cls="ml-1.5 bg-emerald-50 text-emerald-700">saldado</Chip>
            : m.aplicado > 0.5 ? <Chip cls="ml-1.5 bg-amber-50 text-amber-700">parcial · pagado {fmtPesos(m.aplicado)}</Chip> : null}
          {!deEmpleado && m.concepto && <div className="text-[11px] text-muted-foreground truncate max-w-[32rem]">{m.concepto}</div>}
        </td>
        <td className="py-2 px-3 text-right tabular-nums text-muted-foreground hidden sm:table-cell">{fmtPesos(m.importe)}</td>
        <td className={cn("py-2 px-3 text-right tabular-nums", ok && "line-through")}>{fmtPesos(s)}</td>
        <td className="py-2 px-3"><Antiguedad fecha={m.fecha} hoy={hoy} /></td>
        <td className="py-2 px-3 hidden sm:table-cell">
          {!ok && (
            <Boton disabled={guardando} onClick={() => abrirForm({
              tipo: "saldar", keys: [m.key], importe: s,
              desc: m.comprobante ? fmtComprobante(m.comprobante) : `${m.proveedor} · ${m.concepto}`,
            })}>Saldar</Boton>
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
          <span className="inline-flex gap-1.5">
            <button
              type="button"
              disabled={guardando}
              onClick={(e) => { e.stopPropagation(); abrirForm({ tipo: "libre" }); }}
              className="h-7 px-2.5 rounded-md bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 text-xs whitespace-nowrap disabled:opacity-40"
            >
              Registrar pago
            </button>
            {p.saldo > 0.5 && (
              <Boton disabled={guardando} onClick={() => {
                const l = deuda.movimientos.filter((m) => saldoMov(m) > 0.5);
                abrirForm({ tipo: "saldar", keys: l.map((m) => m.key), importe: l.reduce((s, m) => s + saldoMov(m), 0), desc: "todo" });
              }}>Saldar todas</Boton>
            )}
          </span>
        </td>
      </tr>

      {form && (
        <FormPago
          modo={form}
          saldo={p.saldo}
          origenLabel={origenLabel}
          guardando={guardando}
          onCancel={() => setForm(null)}
          onConfirm={async (b) => {
            const err = await p.onRegistrar({ ...b, pdvOrigenId: deuda.pdvOrigenId });
            if (!err) setForm(null);
            return err;
          }}
        />
      )}

      {abierto && deuda.pagos.length > 0 && !buscando && (
        <>
          <tr className="bg-zinc-100 dark:bg-zinc-800">
            <td colSpan={5} className="py-1.5 pl-10 pr-3 text-[11px] font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-300">
              Pagos a {origenLabel}
            </td>
          </tr>
          {deuda.pagos.map((pg) => (
            <tr key={`pg${pg.id}`} className="border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/40 text-xs">
              <td className="py-2 pl-10 pr-3">
                {fmtFecha(pg.fecha)} · {pg.medio}{pg.referencia ? ` · ID ${pg.referencia}` : ""}
                <span className="text-muted-foreground"> · imputado a {pg.movimientos} movimiento{pg.movimientos === 1 ? "" : "s"}
                  {pg.importe - pg.aplicado > 0.5 ? ` · ${fmtPesos(pg.importe - pg.aplicado)} a cuenta` : ""}</span>
              </td>
              <td className="hidden sm:table-cell" />
              <td className="py-2 px-3 text-right tabular-nums">{fmtPesos(pg.importe)}</td>
              <td />
              <td className="py-2 px-3 hidden sm:table-cell">
                <Boton disabled={guardando} onClick={() => p.onAnular(pg.id)}>Anular</Boton>
              </td>
            </tr>
          ))}
        </>
      )}

      {abierto && meses.map((mes) => {
        const km = `${k}M${mes.mes}`;
        const abMes = p.abiertos.has(km) || buscando;
        const pagadoMes = mes.total - mes.saldo;
        const cerrado = mes.saldo < 0.5;
        return (
          <Fragment key={km}>
            <tr onClick={() => p.toggle(km)} className={cn("border-b border-zinc-100 dark:border-zinc-800 cursor-pointer bg-zinc-50 dark:bg-zinc-900/60 hover:bg-zinc-100 dark:hover:bg-zinc-800", cerrado && "text-muted-foreground")}>
              <td className="py-2 pl-8 pr-3">
                <span className="inline-flex items-center gap-1.5 flex-wrap">
                  {abMes ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                  {nombreMes(mes.mes)}
                  <span className="text-xs text-muted-foreground">{mes.movimientos.length} movimientos</span>
                  {cerrado ? <Chip cls="bg-emerald-50 text-emerald-700">saldado</Chip>
                    : pagadoMes > 0.5 ? <Chip cls="bg-amber-50 text-amber-700">parcial · pagado {fmtPesos(pagadoMes)}</Chip> : null}
                </span>
              </td>
              <td className="py-2 px-3 text-right tabular-nums text-muted-foreground hidden sm:table-cell">{fmtPesos(mes.total)}</td>
              <td className={cn("py-2 px-3 text-right tabular-nums", cerrado && "line-through")}>{fmtPesos(mes.saldo)}</td>
              <td className="py-2 px-3"><Antiguedad fecha={`${mes.mes}-01`} hoy={hoy} /></td>
              <td className="py-2 px-3 hidden sm:table-cell">
                {!cerrado && (
                  <Boton disabled={guardando} onClick={() => {
                    const l = mes.movimientos.filter((m) => saldoMov(m) > 0.5);
                    abrirForm({ tipo: "saldar", keys: l.map((m) => m.key), importe: mes.saldo, desc: nombreMes(mes.mes) });
                  }}>Saldar mes</Boton>
                )}
              </td>
            </tr>
            {abMes && agruparEmpleados(mes.movimientos).map((fila) => {
              if (fila.tipo === "mov") return filaMovimiento(fila.mov, "pl-14");
              const ke = `${km}E${fila.nombre}`;
              const abEmp = p.abiertos.has(ke) || buscando;
              const ok = fila.saldo < 0.5;
              return (
                <Fragment key={ke}>
                  <tr onClick={() => p.toggle(ke)} className={cn("border-b border-zinc-100 dark:border-zinc-800 cursor-pointer bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800/60", ok && "text-muted-foreground")}>
                    <td className="py-2 pl-12 pr-3">
                      <span className="inline-flex items-center gap-1.5 flex-wrap">
                        {abEmp ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                        <span className="font-medium">{fila.nombre}</span>
                        <Chip cls="bg-violet-50 text-violet-700">empleado</Chip>
                        <span className="text-xs text-muted-foreground">{fila.movimientos.length} concepto{fila.movimientos.length === 1 ? "" : "s"}</span>
                        {ok ? <Chip cls="bg-emerald-50 text-emerald-700">saldado</Chip>
                          : fila.aplicado > 0.5 ? <Chip cls="bg-amber-50 text-amber-700">parcial · pagado {fmtPesos(fila.aplicado)}</Chip> : null}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums text-muted-foreground hidden sm:table-cell">{fmtPesos(fila.total)}</td>
                    <td className={cn("py-2 px-3 text-right tabular-nums", ok && "line-through")}>{fmtPesos(fila.saldo)}</td>
                    <td className="py-2 px-3"><Antiguedad fecha={fila.movimientos[fila.movimientos.length - 1].fecha} hoy={hoy} /></td>
                    <td className="py-2 px-3 hidden sm:table-cell">
                      {!ok && (
                        <Boton disabled={guardando} onClick={() => {
                          const l = fila.movimientos.filter((m) => saldoMov(m) > 0.5);
                          abrirForm({ tipo: "saldar", keys: l.map((m) => m.key), importe: fila.saldo, desc: `${fila.nombre} · ${nombreMes(mes.mes)}` });
                        }}>Saldar</Boton>
                      )}
                    </td>
                  </tr>
                  {abEmp && fila.movimientos.map((m) => filaMovimiento(m, "pl-20", true))}
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

function FormPago({ modo, saldo, origenLabel, guardando, onCancel, onConfirm }: {
  modo: ModoForm; saldo: number; origenLabel: string; guardando: boolean;
  onCancel: () => void;
  onConfirm: (b: Omit<BodyPagoInterno, "pdvOrigenId">) => Promise<string | null>;
}) {
  const fijo = modo.tipo === "saldar";
  const [importe, setImporte] = useState(importeAInput(fijo ? modo.importe : saldo));
  const [fecha, setFecha] = useState(hoyISO());
  const [medio, setMedio] = useState<MedioPagoInterno>("Transferencia");
  const [referencia, setReferencia] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function confirmar() {
    setError(null);
    const valor = parsearImporteAR(importe);
    if (!fijo && !(valor && valor > 0)) { setError("Cargá un importe."); return; }
    let ref: string | null = null;
    if (medio === "Transferencia") {
      ref = normalizarReferencia(referencia);
      if (!ref) { setError("Cargá el ID de la transferencia (letras y números)."); return; }
    }
    const err = await onConfirm({
      fecha, medio, referencia: ref,
      ...(fijo ? { keys: modo.keys } : { importe: valor! }),
    });
    if (err) setError(err);
  }

  const input = "h-8 rounded-md border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-2 text-sm";
  return (
    <tr className="bg-sky-50 dark:bg-sky-950/40 border-b border-sky-200 dark:border-sky-900">
      <td colSpan={5} className="py-3 px-4">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <b>{fijo ? `Saldar ${modo.desc}` : `Pago a ${origenLabel}`}</b>
          <label className="flex items-center gap-1.5">Importe
            <input
              value={importe}
              readOnly={fijo}
              inputMode="decimal"
              onChange={(e) => setImporte(formatearImporteAR(e.target.value))}
              className={cn(input, "w-44 text-right tabular-nums", fijo && "bg-zinc-100 dark:bg-zinc-700")}
            />
          </label>
          <label className="flex items-center gap-1.5">Fecha
            <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={input} />
          </label>
          <label className="flex items-center gap-1.5">Medio
            <select value={medio} onChange={(e) => setMedio(e.target.value as MedioPagoInterno)} className={input}>
              {MEDIOS_PAGO_INTERNO.map((m) => <option key={m}>{m}</option>)}
            </select>
          </label>
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
            Confirmar
          </button>
          <button type="button" onClick={onCancel} className="h-8 px-3 rounded-md border border-zinc-300 dark:border-zinc-600">Cancelar</button>
        </div>
        <div className="mt-1.5 text-[11px] text-muted-foreground">
          {fijo ? "Se salda el saldo entero de lo elegido." : "Se aplica a lo más viejo primero; si es menos, el último queda parcial; si es más, queda a cuenta."}
        </div>
        {error && <div className="mt-1.5 text-xs text-destructive">{error}</div>}
      </td>
    </tr>
  );
}
