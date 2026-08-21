"use client";
import { calcularSegmentosTimeline, type TimelineReglaInput, type TimelineSegmento } from "@/lib/apertura/timeline-layout";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const ESTADO_CLASES: Record<TimelineReglaInput["estado"], string> = {
  activa: "bg-success/70",
  inactiva: "bg-muted-foreground/30",
  nueva: "bg-primary",
};

function maskFor(seg: TimelineSegmento): string | undefined {
  if (!seg.fadeInicio && !seg.fadeFin) return undefined;
  const inicio = seg.fadeInicio ? "transparent, black 16px" : "black 0";
  const fin = seg.fadeFin ? "black calc(100% - 16px), transparent" : "black 100%";
  return `linear-gradient(to right, ${inicio}, ${fin})`;
}

export function AperturaTimeline({ reglas }: { reglas: TimelineReglaInput[] }) {
  if (reglas.length === 0) {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Vigencia de esta regla</span>
        <p className="text-xs text-muted-foreground py-2">Sin otras reglas para este concepto todavía.</p>
      </div>
    );
  }

  const segmentos = calcularSegmentosTimeline(reglas);

  return (
    <div className="flex flex-col gap-1.5 py-1">
      <span className="text-xs text-muted-foreground mb-1">Vigencia de esta regla</span>
      {segmentos.map((seg) => {
        const mask = maskFor(seg);
        return (
          <div key={String(seg.id)} className="flex items-center gap-2">
            <div className="relative h-5 flex-1 rounded-full bg-muted/50 overflow-hidden">
              {/* Marcas en los extremos: dan referencia visual de "acá empieza / termina el eje". */}
              <div className="absolute inset-y-0 left-0 w-px bg-border" />
              <div className="absolute inset-y-0 right-0 w-px bg-border" />
              <Tooltip>
                <TooltipTrigger asChild>
                  <div
                    className={ESTADO_CLASES[seg.estado] + " absolute inset-y-0 rounded-full"}
                    style={{
                      left: `${seg.leftPct}%`,
                      width: `${seg.widthPct}%`,
                      maskImage: mask,
                      WebkitMaskImage: mask,
                    }}
                  />
                </TooltipTrigger>
                <TooltipContent>{seg.label}</TooltipContent>
              </Tooltip>
            </div>
            <span className="w-40 shrink-0 text-[11px] text-muted-foreground truncate" title={seg.label}>
              {seg.label}
              {seg.estado === "inactiva" && " · inactiva"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
