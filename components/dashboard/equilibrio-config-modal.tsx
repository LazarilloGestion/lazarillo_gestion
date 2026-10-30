"use client";
import { useMemo, useState } from "react";
import { ChevronRight, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { MONTHS } from "@/lib/dashboard/constants";
import { fmtMillones } from "@/lib/dashboard/proyeccion";
import { equilibrioMes } from "@/lib/dashboard/equilibrio";
import { cambiosEntre, claveVar, mapaVariables, pctEfectivo, type GastoConcepto } from "@/lib/dashboard/equilibrio-config";
import { useEquilibrioVariables } from "@/hooks/use-equilibrio-variables";
import { SelectorVariable } from "./selector-variable";

interface Rubro { codigo: string | null; nombre: string; prom: number; conceptos: GastoConcepto[] }

function agrupar(gastos: GastoConcepto[]): Rubro[] {
  const m = new Map<string, Rubro>();
  for (const g of gastos) {
    const k = g.rubroCodigo ?? "__sin";
    const r = m.get(k) ?? { codigo: g.rubroCodigo, nombre: g.rubro, prom: 0, conceptos: [] };
    r.prom += g.prom; r.conceptos.push(g); m.set(k, r);
  }
  return [...m.values()].sort((a, b) => b.prom - a.prom);
}

const nombre = (s: string) => s.toLowerCase().replace(/^\S/, (c) => c.toUpperCase());

// ⚙ de la fila "Punto de equilibrio" (Diego 30/10/2026, opción A): qué gastos acompañan a la venta,
// con el peso de cada rubro (promedio de 6 meses) y el equilibrio del último mes cerrado antes → después.
export function EquilibrioConfigModal({ anio, mes, ventasMes, egresosMes }: {
  anio: number; mes: number; ventasMes: number; egresosMes: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <button type="button" onClick={() => setOpen(true)} title="Qué gastos son variables"
        className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground/70 hover:bg-muted hover:text-foreground align-middle">
        <Settings2 className="h-3.5 w-3.5" />
      </button>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] flex flex-col">
        {open && <Contenido anio={anio} mes={mes} ventasMes={ventasMes} egresosMes={egresosMes} onCerrar={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function Contenido({ anio, mes, ventasMes, egresosMes, onCerrar }: { anio: number; mes: number; ventasMes: number; egresosMes: number; onCerrar: () => void }) {
  const { variables, gastos, isLoading, guardar } = useEquilibrioVariables({ anio, mes });
  const orig = useMemo(() => mapaVariables(variables ?? []), [variables]);
  const [draft, setDraft] = useState<Map<string, number> | null>(null);
  const actual = draft ?? orig;
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  const [guardando, setGuardando] = useState(false);
  const rubros = useMemo(() => agrupar(gastos ?? []), [gastos]);
  const cambios = cambiosEntre(orig, actual);

  const set = (k: string, v: number | undefined) => {
    const n = new Map(actual);
    if (v === undefined) n.delete(k); else n.set(k, v);
    setDraft(n);
  };
  const g = gastos ?? [];
  const varProm = g.reduce((s, x) => s + x.prom * pctEfectivo(actual, x.rubroCodigo, x.codigo) / 100, 0);
  const totProm = g.reduce((s, x) => s + x.prom, 0);
  const varMes = (m: Map<string, number>) => g.reduce((s, x) => s + x.mes * pctEfectivo(m, x.rubroCodigo, x.codigo) / 100, 0);
  const antes = equilibrioMes(ventasMes, egresosMes, varMes(orig));
  const despues = equilibrioMes(ventasMes, egresosMes, varMes(actual));

  async function onGuardar() {
    setGuardando(true);
    const ok = await guardar(cambios);
    setGuardando(false);
    if (ok) { toast.success("Variables del equilibrio guardadas"); onCerrar(); }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-base">Qué gastos acompañan a la venta</DialogTitle>
        <p className="text-xs text-muted-foreground">
          Variable = sube y baja con lo que vendés; lo demás es fijo. Vale para todos los PDV. Un concepto marcado manda sobre su rubro.
          Importes: promedio por mes de los 6 meses hasta {MONTHS[mes - 1].toLowerCase()} {anio}.
        </p>
      </DialogHeader>
      {isLoading || !gastos ? (
        <div className="py-12 flex justify-center"><Spinner size="lg" /></div>
      ) : (
        <div className="min-h-0 overflow-y-auto -mx-4 px-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] text-muted-foreground border-b">
                <th className="text-left font-medium py-1.5">Rubro / concepto</th>
                <th className="text-right font-medium py-1.5 px-2">prom./mes</th>
                <th className="text-left font-medium py-1.5 px-2">Cómo se comporta</th>
                <th className="text-right font-medium py-1.5">variable/mes</th>
              </tr>
            </thead>
            <tbody>
              {rubros.map((r) => {
                const kr = r.codigo != null ? claveVar("rubro", r.codigo) : null;
                const abierto = abiertos.has(r.codigo ?? "__sin");
                const marcados = r.conceptos.filter((c) => actual.has(claveVar("concepto", c.codigo))).length;
                const varR = r.conceptos.reduce((s, c) => s + c.prom * pctEfectivo(actual, c.rubroCodigo, c.codigo) / 100, 0);
                return [
                  <tr key={r.codigo ?? "__sin"} className="border-b border-zinc-100 dark:border-zinc-800">
                    <td className="py-1.5">
                      <button type="button" onClick={() => { const n = new Set(abiertos); const k = r.codigo ?? "__sin"; if (n.has(k)) n.delete(k); else n.add(k); setAbiertos(n); }}
                        className="inline-flex items-center gap-1 text-left font-medium">
                        <ChevronRight className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", abierto && "rotate-90")} />
                        {nombre(r.nombre)}
                      </button>
                      {marcados > 0 && <span className="ml-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 text-[10px] text-emerald-700 dark:bg-emerald-950/30 dark:border-emerald-900">{marcados} concepto{marcados > 1 ? "s" : ""} aparte</span>}
                    </td>
                    <td className="text-right tabular-nums px-2 whitespace-nowrap">{fmtMillones(r.prom)}</td>
                    <td className="px-2">{kr ? <SelectorVariable valor={actual.get(kr)} onChange={(v) => set(kr, v)} /> : <span className="text-xs text-muted-foreground">sin rubro: por concepto</span>}</td>
                    <td className={cn("text-right tabular-nums whitespace-nowrap", varR > 0 ? "text-emerald-700 font-medium" : "text-muted-foreground/50")}>{varR > 0 ? fmtMillones(varR) : "—"}</td>
                  </tr>,
                  ...(abierto ? r.conceptos.filter((c) => c.prom > 0 || actual.has(claveVar("concepto", c.codigo))).map((c) => {
                    const kc = claveVar("concepto", c.codigo);
                    const pc = pctEfectivo(actual, c.rubroCodigo, c.codigo);
                    return (
                      <tr key={kc} className="text-xs text-muted-foreground">
                        <td className="py-1 pl-6">{c.codigo} · {nombre(c.nombre)}</td>
                        <td className="text-right tabular-nums px-2 whitespace-nowrap">{fmtMillones(c.prom)}</td>
                        <td className="px-2"><SelectorVariable compacto heredable heredado={kr ? actual.get(kr) : undefined} valor={actual.get(kc)} onChange={(v) => set(kc, v)} /></td>
                        <td className="text-right tabular-nums whitespace-nowrap">{pc > 0 ? fmtMillones(c.prom * pc / 100) : "—"}</td>
                      </tr>
                    );
                  }) : []),
                ];
              })}
            </tbody>
          </table>
        </div>
      )}
      {gastos && (
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-lg bg-muted px-3 py-2"><div className="text-xs text-muted-foreground">Variable</div><div className="text-base font-semibold text-emerald-700 tabular-nums">{fmtMillones(varProm)}/mes</div></div>
          <div className="rounded-lg bg-muted px-3 py-2"><div className="text-xs text-muted-foreground">Fijo</div><div className="text-base font-semibold tabular-nums">{fmtMillones(totProm - varProm)}/mes</div></div>
          <div className="rounded-lg bg-muted px-3 py-2">
            <div className="text-xs text-muted-foreground">Equilibrio de {MONTHS[mes - 1].toLowerCase()}</div>
            <div className="text-base font-semibold tabular-nums">
              {antes?.equilibrio != null ? fmtMillones(antes.equilibrio) : "—"}
              {cambios.length > 0 && <> → <span className="text-sky-600">{despues?.equilibrio != null ? fmtMillones(despues.equilibrio) : "—"}</span></>}
            </div>
          </div>
        </div>
      )}
      <div className="flex items-center justify-end gap-2">
        {cambios.length > 0 && <span className="mr-auto text-xs text-muted-foreground">{cambios.length} cambio{cambios.length > 1 ? "s" : ""} sin guardar</span>}
        <button type="button" onClick={onCerrar} className="h-8 rounded-md border px-3 text-xs">Cancelar</button>
        <button type="button" onClick={onGuardar} disabled={!cambios.length || guardando}
          className="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50">{guardando ? "Guardando…" : "Guardar"}</button>
      </div>
    </>
  );
}
