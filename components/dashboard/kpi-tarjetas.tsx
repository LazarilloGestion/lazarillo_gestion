"use client";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { useFetchQuery } from "@/hooks/use-fetch-query";
import { useDashboard } from "@/hooks/use-dashboard-store";
import { useProyeccionIngresos } from "@/hooks/use-proyeccion-ingresos";
import { useEgresosProyeccion } from "@/hooks/use-egresos-proyeccion";
import { useEquilibrio } from "@/hooks/use-equilibrio";
import { fmtMillones } from "@/lib/dashboard/proyeccion";
import { equilibrioMes, equilibrioProyectado, pctVariableReciente } from "@/lib/dashboard/equilibrio";
import { alertasDelMes, mesCerrado, tarjetasDelMes, type Alerta, type MesDatos } from "@/lib/dashboard/tarjetas";
import { ImpagasBoton } from "@/components/impagas/impagas-boton";
import { SinCargaBoton } from "@/components/sin-carga/sin-carga-boton";
import type { Local } from "@/lib/types/domain";
import { serieIndicador, sentido, INFO_INDICADOR, type ClaveIndicador } from "@/lib/movil/evolucion";
import { useCanasta } from "@/hooks/use-canasta";
import { CanastaDetalle, CanastaMini, resumirCanasta } from "./canasta-tarjeta";

// Tarjetas arriba de la tabla (rediseño del Panel, Diego 30/10/2026, mockup_panel_v2c):
// el ÚLTIMO MES CERRADO (Ventas → Equilibrio → Resultado, Mix con food cost y personal adentro) y
// el MES EN CURSO solo como proyección. Tocar una tarjeta abre su evolución debajo, a todo el ancho
// (Diego: "el colapso que hace la canasta lo podrían hacer el resto de los KPI").

const MES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const pc = (x: number | null) => (x == null ? "—" : `${(x * 100).toLocaleString("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`);
const ppTxt = (d: number) => `${d > 0 ? "▲" : "▼"} ${Math.abs(d).toLocaleString("es-AR", { maximumFractionDigits: 1 })}`;
type Anual = { meses: MesDatos[] };
type Abierta = ClaveIndicador | "equilibrio" | "canasta" | null;

export function KpiTarjetas() {
  const { year, localId, pdvId, modoPanel, activeSearchParam } = useDashboard();
  const url = (a: number) => {
    const sp = new URLSearchParams({ anio: String(a) });
    if (localId != null) sp.set("localId", String(localId));
    if (pdvId != null) sp.set("pdvId", String(pdvId));
    return `/api/m/anual?${sp.toString()}`;
  };
  // Mismas claves que el celu y la proyección de egresos: comparten caché.
  const { data: anual } = useFetchQuery<Anual>(["m-anual", localId, pdvId, year], url(year), { staleTime: 10 * 60_000 });
  const { data: anualAnt } = useFetchQuery<Anual>(["m-anual", localId, pdvId, year - 1], url(year - 1), { staleTime: 10 * 60_000 });
  const { data: eq } = useEquilibrio();
  const proy = useProyeccionIngresos();
  const egresosPorMes = useMemo(() => Object.fromEntries((anual?.meses ?? []).map((m) => [m.mes, m.rubros.reduce((s, r) => s + r.total, 0)])), [anual]);
  const { proyectado: egrProy, ventasProy } = useEgresosProyeccion(egresosPorMes);
  const [abierta, setAbierta] = useState<Abierta>(null);
  const { data: locales } = useFetchQuery<Local[]>(["locales"], "/api/locales");
  // Canasta del último mes cerrado (Diego 30/10/2026): se pide acá arriba porque los hooks no pueden ir después de un return.
  const hoy0 = new Date();
  const mcCanasta = anual && modoPanel === "economica" && !activeSearchParam ? mesCerrado(anual.meses, year, { anio: hoy0.getFullYear(), mes: hoy0.getMonth() + 1 }) : null;
  const canasta = useCanasta(mcCanasta ? { anio: year, mes: mcCanasta } : null);
  const rc = canasta.data && canasta.data.componentes.length ? resumirCanasta(canasta.data) : null;

  if (modoPanel !== "economica" || activeSearchParam) return null;
  // "Para mirar" (Impagas, Sin carga y alertas) está siempre que haya un PDV elegido: los botones
  // de la barra de filtros se esconden en ese caso (dashboard-filters).
  const paraMirar = (alertas: Alerta[]) => (pdvId != null ? <ParaMirar locales={locales ?? []} pdvId={pdvId} alertas={alertas} /> : null);
  const hoy = new Date();
  const mc = anual ? mesCerrado(anual.meses, year, { anio: hoy.getFullYear(), mes: hoy.getMonth() + 1 }) : null;
  const anteriorDic = anualAnt?.meses.find((m) => m.mes === 12) ?? null;
  const t = anual && mc ? tarjetasDelMes(anual.meses, mc, eq ? eq.porMes[mc]?.total ?? 0 : null, mc === 1 ? anteriorDic : undefined) : null;
  if (!anual || !t) {
    const pm = paraMirar([]);
    return pm ? <div className="mb-4 max-w-sm">{pm}</div> : null;
  }

  // Mes en curso: ventas proyectadas, egresos proyectados y equilibrio con el % variable de los cerrados.
  const enCurso = proy && proy.anio === year && egrProy && ventasProy != null ? proy.mes : null;
  const previos = anual.meses.filter((m) => enCurso && m.mes < enCurso && m.ventas > 0).slice(-3);
  const pctVar = eq ? pctVariableReciente(previos.map((m) => ({ ventas: m.ventas, variable: eq.porMes[m.mes]?.total ?? 0 }))) : null;
  const eqProy = enCurso && pctVar != null
    ? equilibrioProyectado({ ventasProy: ventasProy!, egresosProy: egrProy!.total, pctVariable: pctVar, facturado: proy!.facturado, diasRestantes: proy!.diasRestantes })
    : null;

  const toggle = (k: Abierta) => setAbierta((a) => (a === k ? null : k));
  const e = t.equilibrio;
  const alertas = [
    ...alertasDelMes(anual.meses, t, t.mes <= 6 ? (anualAnt?.meses ?? []).filter((m) => m.mes > t.mes + 6) : []),
    ...(eqProy && eqProy.falta > 0 && enCurso ? [{ texto: `${MES[enCurso - 1]}: faltan ${fmtMillones(eqProy.falta)} para el equilibrio`, nivel: "ambar" as const }] : []),
  ];
  return (
    <div className="mb-4">
      <div className={cn("grid gap-4", enCurso ? (rc ? "lg:grid-cols-[3.5fr_1.4fr_0.95fr]" : "lg:grid-cols-[3fr_1.4fr_0.95fr]") : (rc ? "lg:grid-cols-[3.5fr_0.95fr]" : "lg:grid-cols-[3fr_0.95fr]"))}>
        <div>
          <Grupo>{MES[t.mes - 1]} · último mes cerrado</Grupo>
          <div className={cn("grid grid-cols-2 gap-2", rc ? "md:grid-cols-[1fr_1fr_1fr_1.5fr_1.1fr]" : "md:grid-cols-[1fr_1fr_1fr_1.5fr]")}>
            <Tarjeta titulo="Ventas" activa={abierta === "ventas"} onClick={() => toggle("ventas")}>
              <Grande>{fmtMillones(t.ventas)}</Grande>
              {t.ventasVsAnterior != null && <Chico className={t.ventasVsAnterior >= 0 ? "text-emerald-700" : "text-red-600"}>{t.ventasVsAnterior >= 0 ? "▲" : "▼"} {pc(Math.abs(t.ventasVsAnterior))} vs {MES[(t.mes + 10) % 12].slice(0, 3).toLowerCase()}</Chico>}
            </Tarjeta>
            <Tarjeta titulo="Equilibrio" activa={abierta === "equilibrio"} onClick={() => toggle("equilibrio")} deshabilitada={!e?.equilibrio}>
              <Grande>{e?.equilibrio != null ? fmtMillones(e.equilibrio) : "—"}</Grande>
              {e?.equilibrio != null && <Chico className={e.diferencia >= 0 ? "text-emerald-700" : "text-red-600"}>{e.diferencia >= 0 ? "✓ superado" : `faltaron ${fmtMillones(-e.diferencia)}`}</Chico>}
            </Tarjeta>
            <Tarjeta titulo="Resultado" activa={abierta === "resultado"} onClick={() => toggle("resultado")}>
              <Grande className={t.resultado < 0 ? "text-red-600" : "text-emerald-700"}>{fmtMillones(t.resultado)}</Grande>
              <Chico className="text-muted-foreground">{pc(t.rentabilidad)} rentab.</Chico>
            </Tarjeta>
            <Tarjeta titulo="Mix" activa={abierta === "mix" || abierta === "foodCost" || abierta === "personal"} onClick={() => toggle("mix")}>
              <div className="flex items-baseline gap-2"><Grande>{pc(t.mix)}</Grande>{t.difMix != null && Math.abs(t.difMix) >= 0.05 && <Chico className={t.difMix < 0 ? "text-emerald-700" : "text-red-600"}>{ppTxt(t.difMix)} pp</Chico>}</div>
              <div className="mt-1 flex gap-3 border-t border-dashed border-zinc-200 dark:border-zinc-700 pt-1 text-[12px]">
                <button type="button" className="text-left hover:underline" onClick={(ev) => { ev.stopPropagation(); toggle("foodCost"); }}>
                  Food cost <b>{pc(t.foodCost)}</b>{t.difFoodCost != null && Math.abs(t.difFoodCost) >= 0.05 && <span className={cn("ml-1 font-bold", t.difFoodCost < 0 ? "text-emerald-700" : "text-red-600")}>{ppTxt(t.difFoodCost)}</span>}
                </button>
                <button type="button" className="text-left hover:underline" onClick={(ev) => { ev.stopPropagation(); toggle("personal"); }}>
                  Personal <b>{pc(t.personal)}</b>{t.difPersonal != null && Math.abs(t.difPersonal) >= 0.05 && <span className={cn("ml-1 font-bold", t.difPersonal < 0 ? "text-emerald-700" : "text-red-600")}>{ppTxt(t.difPersonal)}</span>}
                </button>
              </div>
            </Tarjeta>
            {rc && (
              <Tarjeta titulo="Tu canasta" activa={abierta === "canasta"} onClick={() => toggle("canasta")}>
                <CanastaMini r={rc} />
              </Tarjeta>
            )}
          </div>
        </div>
        {enCurso && (
          <div>
            <Grupo>{MES[enCurso - 1]} · proyección al cierre</Grupo>
            <div className="rounded-xl border border-[#5BC2EA] bg-[#5BC2EA]/10 px-3 py-2">
              <div className="flex justify-between gap-3">
                <div><div className="text-[11.5px] text-muted-foreground">Ventas proy.</div><Grande className="text-sky-700 dark:text-sky-300">{fmtMillones(ventasProy!)}</Grande>
                  <Chico className="text-muted-foreground">real {fmtMillones(proy!.facturado)} al {proy!.corte.slice(8, 10)}/{proy!.corte.slice(5, 7)}</Chico></div>
                <div className="text-right"><div className="text-[11.5px] text-muted-foreground">Resultado proy.</div>
                  <Grande className={ventasProy! - egrProy!.total < 0 ? "text-red-600" : "text-sky-700 dark:text-sky-300"}>{fmtMillones(ventasProy! - egrProy!.total)}</Grande>
                  <Chico className="text-muted-foreground">con gastos estimados</Chico></div>
              </div>
              {eqProy?.equilibrio != null && (
                <>
                  <div className="relative mt-2 h-2 rounded bg-white/70 dark:bg-zinc-800">
                    <div className="absolute inset-y-0 left-0 rounded bg-[#5BC2EA]" style={{ width: `${Math.min(100, (proy!.facturado / Math.max(ventasProy!, eqProy.equilibrio)) * 100)}%` }} />
                    <div className="absolute -inset-y-1 w-0.5 bg-zinc-900 dark:bg-white" style={{ left: `${Math.min(100, (eqProy.equilibrio / Math.max(ventasProy!, eqProy.equilibrio)) * 100)}%` }} />
                  </div>
                  <Chico className={eqProy.falta > 0 ? "mt-1 text-amber-700" : "mt-1 text-emerald-700"}>
                    {eqProy.falta > 0
                      ? <>equilibrio {fmtMillones(eqProy.equilibrio)} · faltan {fmtMillones(eqProy.falta)}{eqProy.porDia != null && <> · {fmtMillones(eqProy.porDia)}/día</>}</>
                      : <>✓ equilibrio {fmtMillones(eqProy.equilibrio)} superado</>}
                  </Chico>
                </>
              )}
            </div>
          </div>
        )}
        {pdvId != null && <div className="flex flex-col"><Grupo>&nbsp;</Grupo>{paraMirar(alertas)}</div>}
      </div>
      {abierta === "canasta" && canasta.data && rc && (
        <CanastaDetalle d={canasta.data} r={rc} mesRef={t.mes} conPdv={canasta.conPdv}
          onAgregar={(f) => void canasta.agregarAumento(f)} onQuitar={(f) => void canasta.quitarAumento(f)} onDetectar={canasta.detectar} onCerrar={() => setAbierta(null)} />
      )}
      {abierta && abierta !== "canasta" && (
        <Evolucion clave={abierta} anio={year} mesHasta={t.mes} meses={anual.meses} mesesAnt={anualAnt?.meses ?? []}
          variablePorMes={eq?.porMes ?? null} onCerrar={() => setAbierta(null)} />
      )}
    </div>
  );
}

// Impagas, Sin carga y alertas en una tarjeta que NUNCA es más alta que las de KPI (Diego 30/10/2026):
// tres renglones a la vista y el resto en "+N más".
function ParaMirar({ locales, pdvId, alertas }: { locales: Local[]; pdvId: number; alertas: Alerta[] }) {
  const [mas, setMas] = useState(false);
  const visibles = alertas.slice(0, 1), resto = alertas.slice(1);
  const linea = (a: Alerta) => (
    <div key={a.texto} className="flex items-center gap-1.5">
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", a.nivel === "rojo" ? "bg-red-500" : "bg-amber-500")} />
      <span className="truncate" title={a.texto}>{a.texto}</span>
    </div>
  );
  return (
    <div className="relative flex-1 rounded-xl border border-amber-300/70 bg-amber-50/70 dark:bg-amber-950/20 px-3 py-2 text-[12.5px] leading-[1.55] max-h-[96px]">
      <div className="flex justify-between text-[11.5px] text-muted-foreground"><span>Para mirar</span>{alertas.length > 0 && <b className="text-amber-700">{alertas.length}</b>}</div>
      <ImpagasBoton locales={locales} pdvId={pdvId} variante="linea" />
      <SinCargaBoton variante="linea" />
      {visibles.map(linea)}
      {resto.length > 0 && (
        <button type="button" onClick={() => setMas((v) => !v)} className="text-[11.5px] font-bold text-amber-700 hover:underline">
          {mas ? "menos ▴" : `+${resto.length} más ›`}
        </button>
      )}
      {mas && (
        <div className="absolute right-0 top-full z-30 mt-1 w-72 rounded-xl border border-amber-300 bg-white dark:bg-zinc-900 px-3 py-2 shadow-lg">
          {resto.map(linea)}
        </div>
      )}
    </div>
  );
}

function Grupo({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">{children}</div>;
}
function Grande({ children, className }: { children: React.ReactNode; className?: string }) {
  return <b className={cn("block text-[18px] tabular-nums leading-tight", className)}>{children}</b>;
}
function Chico({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("text-[11.5px] font-semibold leading-snug", className)}>{children}</div>;
}
function Tarjeta({ titulo, activa, deshabilitada, onClick, children }: { titulo: string; activa?: boolean; deshabilitada?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <div role="button" tabIndex={0} onClick={() => { if (!deshabilitada) onClick(); }} onKeyDown={(ev) => { if (!deshabilitada && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); onClick(); } }}
      className={cn("rounded-xl border bg-white dark:bg-zinc-900 px-3 py-2 text-left transition-colors",
        deshabilitada ? "cursor-default" : "cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/60",
        activa ? "border-zinc-900 dark:border-white ring-1 ring-zinc-900 dark:ring-white" : "border-zinc-200 dark:border-zinc-700")}>
      <div className="flex justify-between text-[11.5px] text-muted-foreground"><span>{titulo}</span>{!deshabilitada && <span>{activa ? "▴" : "▾"}</span>}</div>
      {children}
    </div>
  );
}

// Evolución de la tarjeta tocada, a todo el ancho (como en el celu): barras de los últimos 3/6/9/12 meses.
function Evolucion({ clave, anio, mesHasta, meses, mesesAnt, variablePorMes, onCerrar }: {
  clave: Exclude<Abierta, null | "canasta">; anio: number; mesHasta: number; meses: MesDatos[]; mesesAnt: MesDatos[];
  variablePorMes: Record<number, { total: number }> | null; onCerrar: () => void;
}) {
  const [n, setN] = useState(6);
  const todos = [...mesesAnt.map((m) => ({ ...m, anio: anio - 1 })), ...meses.map((m) => ({ ...m, anio }))];
  type Punto = { anio: number; mes: number; valor: number | null; dif: number | null; marca?: number | null };
  let serie: Punto[];
  let titulo: string; let plata: boolean; let claveSentido: ClaveIndicador;
  if (clave === "equilibrio") {
    // Barras = ventas; marca = equilibrio del mes (solo el año que se mira: las variables vienen por año).
    titulo = "Ventas y punto de equilibrio"; plata = true; claveSentido = "ventas";
    serie = serieIndicador({ meses: todos, clave: "ventas", hasta: { anio, mes: mesHasta }, n }).map((p) => {
      const m = p.anio === anio ? meses.find((x) => x.mes === p.mes) : null;
      const e = m && variablePorMes ? equilibrioMes(m.ventas, m.rubros.reduce((s, r) => s + r.total, 0), variablePorMes[p.mes]?.total ?? 0) : null;
      return { ...p, marca: e?.equilibrio ?? null };
    });
  } else {
    titulo = INFO_INDICADOR[clave].titulo; plata = INFO_INDICADOR[clave].tipo === "plata"; claveSentido = clave;
    serie = serieIndicador({ meses: todos, clave, hasta: { anio, mes: mesHasta }, n });
  }
  // Misma escala para barras y marca; la más baja arranca en 25% para que se vean las diferencias
  // sin exagerarlas (como en el celu).
  const vals = serie.flatMap((x) => [x.valor, x.marca ?? null]).filter((v): v is number => v != null);
  const min = vals.length ? Math.min(...vals) : 0, max = vals.length ? Math.max(...vals) : 1;
  const alto = (v: number) => (max > min ? 25 + ((v - min) / (max - min)) * 75 : 60);
  const fmt = (v: number) => (plata ? fmtMillones(v) : pc(v));
  return (
    <div className="mt-3 rounded-xl border border-zinc-300 dark:border-zinc-600 bg-zinc-50/60 dark:bg-zinc-900 px-4 py-3">
      <div className="flex items-center gap-3">
        <b className="text-[15px]">{titulo}</b>
        <span className="inline-flex rounded-lg bg-zinc-200/70 dark:bg-zinc-800 p-0.5 text-[12px]">
          {[3, 6, 9, 12].map((k) => (
            <button key={k} type="button" onClick={() => setN(k)} className={cn("rounded-md px-2.5 py-0.5 font-semibold", n === k ? "bg-white dark:bg-zinc-700 shadow-sm" : "text-muted-foreground")}>{k}</button>
          ))}
          <span className="self-center px-1.5 text-muted-foreground">meses</span>
        </span>
        <span className="text-[11.5px] text-muted-foreground">{plata ? "% contra el mes anterior" : "pp = puntos contra el mes anterior"} · verde mejora · rojo empeora</span>
        <button type="button" onClick={onCerrar} className="ml-auto text-[12px] font-semibold text-muted-foreground hover:text-foreground">▴ cerrar</button>
      </div>
      <div className="mt-3 flex gap-2">
        {serie.map((x) => {
          const s = sentido(claveSentido, x.dif);
          return (
            <div key={`${x.anio}-${x.mes}`} className="flex flex-1 flex-col items-center">
              <div className="relative h-36 w-full max-w-[72px]">
                {x.valor != null && (
                  <>
                    <div className={cn("absolute inset-x-0 bottom-0 rounded-t-md", x.valor < 0 ? "bg-red-400" : "bg-[#5BC2EA]")} style={{ height: `${alto(x.valor) * 0.82}%` }} />
                    <span className="absolute inset-x-[-12px] text-center whitespace-nowrap text-[11px] font-semibold tabular-nums" style={{ bottom: `calc(${alto(x.valor) * 0.82}% + 2px)` }}>{fmt(x.valor)}</span>
                  </>
                )}
                {x.marca != null && <div className="absolute inset-x-[-5px] h-[3px] rounded bg-zinc-900 dark:bg-white" style={{ bottom: `${alto(x.marca) * 0.82}%` }} title={`Equilibrio ${fmtMillones(x.marca)}`} />}
              </div>
              <span className="mt-1 h-4 text-[11px] text-muted-foreground">{MES[x.mes - 1].slice(0, 3).toLowerCase()}{x.anio !== anio ? ` ${String(x.anio).slice(2)}` : ""}</span>
              <span className={cn("h-4 text-[10.5px] font-bold tabular-nums", s === "bueno" ? "text-emerald-700" : s === "malo" ? "text-red-600" : "text-muted-foreground")}>
                {x.dif != null && Math.abs(x.dif) >= 0.05 ? `${x.dif > 0 ? "▲" : "▼"}${Math.abs(x.dif).toLocaleString("es-AR", { maximumFractionDigits: 1 })}${plata ? "%" : ""}` : ""}
              </span>
            </div>
          );
        })}
      </div>
      {clave === "equilibrio" && <div className="mt-1 text-[11.5px] text-muted-foreground">Barra = ventas · línea negra = punto de equilibrio del mes (con los gastos variables configurados).</div>}
    </div>
  );
}
