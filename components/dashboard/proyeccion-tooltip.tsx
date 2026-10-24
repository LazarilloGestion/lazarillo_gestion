"use client";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { fmtMillones, DIA_SEMANA_CORTO, type ProyeccionMes } from "@/lib/dashboard/proyeccion";

const pct = (x: number) => `${Math.round(x * 100)}%`;
const pct1 = (x: number) => `${(x * 100).toLocaleString("es-AR", { maximumFractionDigits: 1 })}%`;
const ddmm = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`;

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
          {p.metodo === "semanas" ? (
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
            Con el otro cálculo ({p.metodo === "semanas" ? "promedio de cada día en el mes" : "8 semanas × ritmo"}):{" "}
            {fmtMillones(p.proyecciones[p.metodo === "semanas" ? "dias_mes" : "semanas"])}
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
                este cálculo erró <b className="opacity-100">{pct1(p.backtest.errorMetodo)}</b> en promedio; el otro,{" "}
                <b className="opacity-100">{pct1(p.backtest.errores[p.metodo === "semanas" ? "dias_mes" : "semanas"])}</b>
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
