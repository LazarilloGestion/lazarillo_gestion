"use client";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { fmtMillones, DIA_SEMANA_CORTO, type Metodo, type ProyeccionMes } from "@/lib/dashboard/proyeccion";
import type { EgresosProyectados } from "@/lib/dashboard/egresos-proy";
import type { FaltaCargar } from "@/hooks/use-egresos-proyeccion";
import type { EquilibrioMes, EquilibrioProyectado } from "@/lib/dashboard/equilibrio";

const pct = (x: number) => `${Math.round(x * 100)}%`;
const pct1 = (x: number) => `${(x * 100).toLocaleString("es-AR", { maximumFractionDigits: 1 })}%`;
const ddmm = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`;
const NOMBRE: Record<Metodo, string> = { unico: "el cálculo completo", semanas: "8 semanas × ritmo", dias_mes: "el promedio de cada día en el mes" };
const OTROS: Record<Metodo, Metodo[]> = { unico: ["semanas", "dias_mes"], semanas: ["unico", "dias_mes"], dias_mes: ["unico", "semanas"] };
// 1,23 → "un 23% más de lo habitual"; 0,9 → "un 10% menos"; ~1 → "lo habitual".
const estacionalTxt = (f: number) =>
  Math.abs(f - 1) < 0.02 ? "lo habitual" : `un ${Math.round(Math.abs(f - 1) * 100)}% ${f > 1 ? "más" : "menos"} de lo habitual`;

// Celda de Ingresos del mes incompleto: el valor subrayado (sin ensanchar la
// columna) y, al pasar el mouse, cómo se llega a la proyección de cierre.
export function ProyeccionIngresos({ p, children }: { p: ProyeccionMes; children: React.ReactNode }) {
  const mesLargo = new Date(Date.UTC(p.anio, p.mes - 1, 1)).toLocaleDateString("es-AR", { month: "long", timeZone: "UTC" });
  const mesNombre = mesLargo.charAt(0).toUpperCase() + mesLargo.slice(1);
  const mesAA = `${mesLargo.slice(0, 3)}-${p.anio - 1}`;
  const siguiente = `${String(p.diasTranscurridos + 1).padStart(2, "0")}/${String(p.mes).padStart(2, "0")}`;
  const fin = `${p.diasMes}/${String(p.mes).padStart(2, "0")}`;
  const pctFacturado = Math.min(100, (p.facturado / p.proyeccion) * 100);

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-help border-b-[1.5px] border-dashed border-[#5BC2EA]">{children}</span>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="end" className="block max-w-none w-[360px] p-3.5 text-[12.5px] leading-[1.45] font-normal text-left">
          <div className="opacity-60">Proyección de cierre · {mesNombre} {p.anio}</div>
          <div className="text-[22px] font-bold my-0.5">{fmtMillones(p.proyeccion)}</div>
          {p.rango && (
            <div className="opacity-60">
              rango probable {fmtMillones(p.rango.min)} – {fmtMillones(p.rango.max)} (±{pct(p.backtest!.errorMetodo)})
            </div>
          )}
          <div className="relative h-2 rounded bg-white/15 dark:bg-black/15 my-2 overflow-hidden">
            <div className="absolute inset-y-0 left-0 bg-[#5BC2EA]" style={{ width: `${pctFacturado}%` }} />
            <div
              className="absolute inset-y-0 right-0"
              style={{ left: `${pctFacturado}%`, background: "repeating-linear-gradient(45deg,#5BC2EA66 0 4px,transparent 4px 8px)" }}
            />
          </div>
          <Fila izq={`Facturado al ${ddmm(p.corte)} (${p.diasTranscurridos} días)`} der={fmtMillones(p.facturado)} />
          <Fila izq={`Estimado ${siguiente} → ${fin} (${p.diasRestantes} días)`} der={fmtMillones(p.estimadoRestante)} />
          <div className="opacity-60 mt-0.5">
            quedan{" "}
            {p.restantesPorDia.map((d) => (
              <span key={d.dow} className="inline-block mr-1 mt-0.5 text-[11px] rounded px-1.5 bg-white/15 dark:bg-black/15">
                {d.cantidad} {DIA_SEMANA_CORTO[d.dow]}
              </span>
            ))}
          </div>
          <Sep />
          <div className="opacity-60 mb-1">Cómo se calcula</div>
          {p.metodo === "unico" ? (
            <div>
              Cada día que falta vale lo que suele vender <b>ese día de la semana</b> (últimas 8 semanas)
              {p.estacional != null && (
                <> × la <b>época del año</b>: en los años anteriores, el resto de {mesLargo} vendió {estacionalTxt(p.estacional)}</>
              )}{" "}
              × el <b>ritmo del mes</b>: {mesLargo} viene al <b>{pct(p.ritmoEstacional)}</b> de lo esperado.
            </div>
          ) : p.metodo === "semanas" ? (
            <div>
              Cada día que falta vale lo que suele vender <b>ese día de la semana</b> (promedio de las últimas 8 semanas) × el{" "}
              <b>ritmo del mes</b>: {mesLargo} viene al <b>{pct(p.ritmo)}</b> de lo habitual.
            </div>
          ) : (
            <div>
              Cada día que falta vale el <b>promedio de ese día de la semana en {mesLargo}</b> (los jueves que faltan, lo que vienen
              vendiendo los jueves de este mes).
            </div>
          )}
          <div className="opacity-60 mt-1">
            {OTROS[p.metodo].map((m) => <Fila key={m} izq={`Con ${NOMBRE[m]}`} der={fmtMillones(p.proyecciones[m])} />)}
          </div>
          <Sep />
          <div className="opacity-60">
            <Fila izq="Regla de 3 simple" der={fmtMillones(p.reglaDeTres)} />
            {p.mismoRitmoAnioAnterior != null && <Fila izq={`Mismo ritmo que ${mesAA}`} der={fmtMillones(p.mismoRitmoAnioAnterior)} />}
            {p.cierreAnioAnterior != null && <Fila izq={`${mesNombre} ${p.anio - 1} cerró en`} der={fmtMillones(p.cierreAnioAnterior)} />}
          </div>
          {p.backtest && (
            <>
              <Sep />
              <div className="opacity-60">
                {p.backtest.fuente === "guardadas"
                  ? <>Medido con lo que proyectó cada día en los últimos {p.backtest.meses} meses contra cómo cerraron: </>
                  : <>Probado contra los {p.backtest.meses} meses anteriores cortando cada uno el día {p.backtest.dia}: </>}
                este cálculo erró <b className="opacity-100">{pct1(p.backtest.errorMetodo)}</b> en promedio
                {OTROS[p.metodo].map((m) => (
                  <span key={m}>; {NOMBRE[m]}, <b className="opacity-100">{pct1(p.backtest!.errores[m])}</b></span>
                ))}
                {p.backtest.errorReglaDeTres != null && (
                  <>; la regla de 3, <b className="opacity-100">{pct1(p.backtest.errorReglaDeTres)}</b></>
                )}
                . Se usa el que menos erra, y cada día se guarda lo proyectado para seguir midiendo.
              </div>
            </>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

const nombreMes = (anio: number, mes: number) => {
  const m = new Date(Date.UTC(anio, mes - 1, 1)).toLocaleDateString("es-AR", { month: "long", timeZone: "UTC" });
  return m.charAt(0).toUpperCase() + m.slice(1);
};
const capital = (t: string) => t.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());

// Egresos del mes en curso (Diego 28/10/2026): proyección de cierre con el cálculo del celu.
export function ProyeccionEgresos({ e, anio, corte, ventasProy, children }: { e: EgresosProyectados; anio: number; corte: string | null; ventasProy: number | null; children: React.ReactNode }) {
  // % de cada rubro sobre las ventas proyectadas (Diego 28/10/2026).
  const sv = (n: number) => (ventasProy && ventasProy > 0 ? ` · ${((n / ventasProy) * 100).toLocaleString("es-AR", { maximumFractionDigits: 1 })}%` : "");
  const pc = (n: number) => `${Math.max(0, Math.min(100, (n / e.total) * 100))}%`;
  const top = e.rubros.slice(0, 4);
  const otros = e.rubros.slice(4).reduce((s, r) => s + r.total, 0);
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-help border-b-[1.5px] border-dashed border-[#5BC2EA]">{children}</span>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="end" className="block max-w-none w-[360px] p-3.5 text-[12.5px] leading-[1.45] font-normal text-left">
          <div className="opacity-60">Egresos · proyección de cierre {nombreMes(anio, e.mes)} {anio}</div>
          <div className="text-[22px] font-bold my-0.5">{fmtMillones(e.total)}</div>
          <div className="opacity-60">hoy cargado {fmtMillones(e.cargado)}</div>
          <div className="flex h-2 rounded bg-white/15 dark:bg-black/15 my-2 overflow-hidden">
            <div className="bg-[#5BC2EA]" style={{ width: pc(e.cargado) }} />
            <div className="bg-[#f5c26b]" style={{ width: pc(e.sinCargar) }} />
            <div className="flex-1" style={{ background: "repeating-linear-gradient(45deg,#5BC2EA66 0 4px,transparent 4px 8px)" }} />
          </div>
          <Fila izq={`Cargado${corte ? ` al ${corte.slice(8, 10)}/${corte.slice(5, 7)}` : ""}`} der={fmtMillones(e.cargado)} />
          <Fila izq="Falta cargar (Sin carga)" der={fmtMillones(e.sinCargar)} />
          <Fila izq="Variable estimado" der={fmtMillones(e.variable)} />
          <Sep />
          <div className="opacity-60 mb-1 flex justify-between"><span>Por rubro</span><span>% s/ ventas proy.</span></div>
          {top.map((r) => <Fila key={r.rubro} izq={capital(r.rubro)} der={fmtMillones(r.total) + sv(r.total)} />)}
          {otros > 0.5 && <Fila izq="Otros" der={fmtMillones(otros) + sv(otros)} />}
          <div className="mt-1 opacity-80"><Fila izq="Total" der={fmtMillones(e.total) + sv(e.total)} /></div>
          <Sep />
          <div className="opacity-60">
            Mercaderías: food cost de los meses cerrados{e.foodCost != null ? ` (${Math.round(e.foodCost * 100)}%)` : ""} × ventas proyectadas.
            El resto de los rubros, su promedio. Nunca menos que lo cargado + lo que falta cargar.
          </div>
          <RevisarArca />
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// Mes cerrado con gastos de todos los meses que todavía no están cargados.
export function FaltaCargarTip({ f, anio, mes, real, children }: { f: FaltaCargar; anio: number; mes: number; real?: number; children: React.ReactNode }) {
  const lista = f.items.slice(0, 6);
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-help">
            <Punto />
            {children}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="end" className="block max-w-none w-[340px] p-3.5 text-[12.5px] leading-[1.45] font-normal text-left">
          <div className="opacity-60">Egresos · {nombreMes(anio, mes)} {anio}</div>
          <div className="flex justify-between gap-3 mt-1"><span><Punto />Falta cargar · {f.n}</span><b className="tabular-nums">{fmtMillones(f.total)}</b></div>
          {real != null && <div className="flex justify-between gap-3"><span className="opacity-70">Con eso, el mes cerraría en</span><b className="tabular-nums">{fmtMillones(real + f.total)}</b></div>}
          <div className="opacity-70 mt-1">
            {lista.map((x) => <Fila key={x.clave} izq={x.nombre} der={fmtMillones(x.ultimo)} />)}
            {f.items.length > lista.length && <div>y {f.items.length - lista.length} más</div>}
          </div>
          <Sep />
          <div className="opacity-60">Gastos de todos los meses que este mes todavía no están (monto del último mes). Se ven y se descartan en Sin carga.</div>
          <RevisarArca />
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// Lo de ARCA queda afuera del cálculo (Diego 28/10/2026: "dejalo afuera y en todo caso poné revisar ARCA").
function RevisarArca() {
  return (
    <div className="mt-2 rounded-md bg-white/10 dark:bg-black/10 px-2 py-1.5">
      <b>Revisar ARCA</b> <span className="opacity-70">· las facturas que ARCA tiene y no están cargadas no se cuentan acá (Sin carga → ARCA).</span>
    </div>
  );
}

// Tooltip chico para Resultado OP y Gastos / Ventas: la celda muestra lo real y acá va lo proyectado.
export function TipProyectado({ titulo, grande, negativo, filas, children }: { titulo: string; grande: string; negativo?: boolean; filas: [string, string][]; children: React.ReactNode }) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-help border-b-[1.5px] border-dashed border-[#5BC2EA]">{children}</span>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="end" className="block max-w-none w-[300px] p-3.5 text-[12.5px] leading-[1.45] font-normal text-left">
          <div className="opacity-60">{titulo}</div>
          <div className={`text-[20px] font-bold my-0.5${negativo ? " text-red-400" : ""}`}>{grande}</div>
          {filas.map(([a, b]) => <Fila key={a} izq={a} der={b} />)}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// Punto de equilibrio de un mes (Diego 30/10/2026): cuánto había que vender, de dónde sale y cuánto
// quedó de lo vendido arriba. En el mes en curso, con la proyección y lo que falta por día.
export function EquilibrioTip({ e, p, anio, mes, detalle, variables, children }: {
  e: EquilibrioMes; p?: EquilibrioProyectado | null; anio: number; mes: number;
  detalle: { nombre: string; total: number }[]; variables: string[]; children: React.ReactNode;
}) {
  const pc = (x: number) => `${(x * 100).toLocaleString("es-AR", { maximumFractionDigits: 1 })}%`;
  const arriba = e.diferencia >= 0;
  const resultado = e.diferencia * e.queda;
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-help border-b-[1.5px] border-dashed border-muted-foreground/40">{children}</span>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="end" className="block max-w-none w-[360px] p-3.5 text-[12.5px] leading-[1.45] font-normal text-left">
          <div className="opacity-60">Punto de equilibrio · {nombreMes(anio, mes)} {anio}{p ? " · proyección" : ""}</div>
          <div className="text-[22px] font-bold my-0.5">{e.equilibrio == null ? "—" : fmtMillones(e.equilibrio)}</div>
          <div className={arriba ? "text-emerald-400" : "text-red-400"}>
            {p ? "vendería" : "vendió"} {fmtMillones(e.ventas)} · {arriba ? `${fmtMillones(e.diferencia)} arriba` : `${fmtMillones(-e.diferencia)} abajo`}
          </div>
          <Sep />
          <Fila izq="Gastos fijos" der={fmtMillones(e.fijos)} />
          <Fila izq={`Gastos variables (${pc(e.pctVariable)} de la venta)`} der={fmtMillones(e.variable)} />
          {!p && <div className="opacity-60">{detalle.slice(0, 4).map((d) => <Fila key={d.nombre} izq={`· ${capital(d.nombre)}`} der={fmtMillones(d.total)} />)}</div>}
          <div className="opacity-60 mt-1">Fijos ÷ (1 − {pc(e.pctVariable)}) = {e.equilibrio == null ? "—" : fmtMillones(e.equilibrio)}</div>
          <Sep />
          <div>
            De cada $ 100 que se venden arriba del equilibrio quedan <b>$ {Math.round(e.queda * 100)}</b>{" "}
            (el resto se va en los gastos variables). {p ? "Te quedaría" : "Te quedó"}{" "}
            <b className={resultado < 0 ? "text-red-400" : ""}>{p ? "~" : ""}{fmtMillones(resultado)}</b>.
          </div>
          {p && (
            <>
              <Sep />
              {p.falta > 0
                ? <div>Facturado {fmtMillones(p.facturado)}: faltan <b>{fmtMillones(p.falta)}</b> para llegar{p.porDia != null ? <> · <b>{fmtMillones(p.porDia)} por día</b> en los {p.diasRestantes} días que quedan</> : null}.</div>
                : <div className="text-emerald-400">Ya se superó con lo facturado ({fmtMillones(p.facturado)}).</div>}
              <div className="opacity-60 mt-1">Con los egresos proyectados y el % variable de los meses cerrados.</div>
            </>
          )}
          <Sep />
          <div className="opacity-60">Variables: {variables.join(", ")}. El resto es fijo.</div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function Punto() {
  return <span aria-label="falta cargar" style={{ display: "inline-block", width: 7, height: 7, borderRadius: 999, background: "#e0a21b", marginRight: 6, verticalAlign: 1 }} />;
}

function Fila({ izq, der }: { izq: string; der: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span>{izq}</span>
      <b className="tabular-nums whitespace-nowrap">{der}</b>
    </div>
  );
}

function Sep() {
  return <div className="border-t border-white/20 dark:border-black/20 my-2.5" />;
}
