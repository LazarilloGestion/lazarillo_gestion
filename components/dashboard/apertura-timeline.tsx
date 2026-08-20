"use client";
import { calcularSegmentosTimeline, type TimelineReglaInput, type TimelineSegmento } from "@/lib/apertura/timeline-layout";

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
    return <p className="text-xs text-muted-foreground py-2">Sin otras reglas para este concepto todavía.</p>;
  }

  const segmentos = calcularSegmentosTimeline(reglas);

  return (
    <div className="flex flex-col gap-1.5 py-1">
      {segmentos.map((seg) => {
        const mask = maskFor(seg);
        return (
          <div key={String(seg.id)} className="flex items-center gap-2">
            <div className="relative h-4 flex-1 rounded bg-muted/50 overflow-hidden">
              <div
                className={ESTADO_CLASES[seg.estado] + " absolute inset-y-0 rounded"}
                style={{
                  left: `${seg.leftPct}%`,
                  width: `${seg.widthPct}%`,
                  maskImage: mask,
                  WebkitMaskImage: mask,
                }}
                title={seg.label}
              />
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
