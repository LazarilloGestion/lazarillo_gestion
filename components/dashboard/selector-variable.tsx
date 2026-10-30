"use client";
import { cn } from "@/lib/utils";
import { etiquetaPct } from "@/lib/dashboard/equilibrio-config";

type Modo = "hereda" | "fijo" | "variable" | "pct";

function modoDe(valor: number | undefined, heredable: boolean): Modo {
  if (valor === undefined) return heredable ? "hereda" : "fijo";
  if (valor === 0) return "fijo";
  if (valor === 100) return "variable";
  return "pct";
}

const ESTILO_ON: Record<Modo, string> = {
  hereda: "bg-zinc-200 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100",
  fijo: "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900",
  variable: "bg-emerald-600 text-white",
  pct: "bg-sky-500 text-white",
};

// Fijo / Variable / % de un rubro o concepto para el punto de equilibrio. En un concepto (heredable)
// aparece "= rubro": sin marca propia sigue a su rubro; "Fijo" guarda 0 y gana aunque el rubro sea variable.
export function SelectorVariable({ valor, heredable = false, heredado, onChange, compacto = false }: {
  valor: number | undefined;
  heredable?: boolean;
  heredado?: number;
  onChange: (v: number | undefined) => void;
  compacto?: boolean;
}) {
  const modo = modoDe(valor, heredable);
  const opciones: { m: Modo; label: string; title?: string; v: () => number | undefined }[] = [
    ...(heredable ? [{ m: "hereda" as Modo, label: "= rubro", title: `Igual que su rubro (${etiquetaPct(heredado).toLowerCase()})`, v: () => undefined }] : []),
    { m: "fijo", label: "Fijo", v: () => (heredable ? 0 : undefined) },
    { m: "variable", label: "Variable", v: () => 100 },
    { m: "pct", label: "%", title: "Una parte variable (ej. luz y gas que suben con la cocina)", v: () => (valor != null && valor > 0 && valor < 100 ? valor : 50) },
  ];
  const btn = compacto ? "h-6 px-2 text-[11px]" : "h-7 px-2.5 text-xs";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-flex items-center gap-0.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 p-0.5">
        {opciones.map((o) => (
          <button key={o.m} type="button" title={o.title} aria-pressed={modo === o.m} onClick={() => onChange(o.v())}
            className={cn("rounded-md font-medium transition-all", btn, modo === o.m ? ESTILO_ON[o.m] : "text-muted-foreground hover:text-foreground")}>
            {o.label}
          </button>
        ))}
      </span>
      {modo === "pct" && (
        <input
          type="number" min={1} max={99} step={1} value={valor ?? ""} aria-label="% variable"
          onChange={(e) => { const n = Math.round(Number(e.target.value)); if (Number.isFinite(n)) onChange(Math.min(99, Math.max(1, n))); }}
          className={cn("w-14 rounded-md border border-sky-400 bg-white dark:bg-zinc-800 px-1.5 text-right tabular-nums outline-none", compacto ? "h-6 text-[11px]" : "h-7 text-xs")}
        />
      )}
    </span>
  );
}
