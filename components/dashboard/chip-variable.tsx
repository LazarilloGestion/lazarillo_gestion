"use client";
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { etiquetaPct, type CambioVariable, type TipoVariable } from "@/lib/dashboard/equilibrio-config";
import { SelectorVariable } from "./selector-variable";

// Chip Fijo / Variable / % del punto de equilibrio en Conceptos de caja (Diego 30/10/2026, opción B):
// se toca, se elige y se guarda al toque. En un concepto sin marca muestra "= rubro".
export function ChipVariable({ tipo, codigo, valor, heredado, guardar }: {
  tipo: TipoVariable;
  codigo: string;
  valor: number | undefined;
  heredado?: number;
  guardar: (c: CambioVariable[]) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const hereda = tipo === "concepto" && valor === undefined;
  const efectivo = hereda ? heredado : valor;
  const texto = hereda ? "= rubro" : etiquetaPct(valor);
  const color = hereda ? "border-zinc-200 text-zinc-400 dark:border-zinc-700"
    : !efectivo ? "border-zinc-200 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
    : efectivo === 100 ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:border-emerald-900"
    : "border-sky-200 bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:border-sky-900";

  async function cambiar(v: number | undefined) {
    setGuardando(true);
    await guardar([{ tipo, codigo, pct: v ?? null }]);
    setGuardando(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" title={`Punto de equilibrio: ${hereda ? `igual que su rubro (${etiquetaPct(heredado).toLowerCase()})` : texto.toLowerCase()}`}
          className={cn("inline-flex h-5 shrink-0 items-center rounded border px-1.5 text-[10px] font-medium", color, guardando && "opacity-50",
            // Sin marca propia solo aparece al pasar el mouse por la fila (menos botones a la vista).
            hereda && "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100")}>
          {texto}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-2 gap-1.5">
        <div className="text-[11px] text-muted-foreground">Punto de equilibrio · vale para todos los PDV</div>
        <SelectorVariable compacto heredable={tipo === "concepto"} heredado={heredado} valor={valor} onChange={cambiar} />
      </PopoverContent>
    </Popover>
  );
}
