"use client";
import { Check, X, Pencil } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function EditActionButtons({
  onSave,
  onCancel,
  saving,
  saveDisabled = false,
  saveDisabledTitle,
}: {
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  /** Deshabilita solo el botón de guardar (Cancelar sigue disponible). */
  saveDisabled?: boolean;
  saveDisabledTitle?: string;
}) {
  return (
    <div className="flex items-center gap-1">
      <button
        onClick={onSave}
        disabled={saving || saveDisabled}
        title={saveDisabled ? saveDisabledTitle : undefined}
        className="flex h-6 w-6 items-center justify-center rounded text-success hover:bg-success/10 disabled:opacity-40"
      >
        <Check className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={onCancel}
        disabled={saving}
        className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted disabled:opacity-40"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function EditTriggerButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-muted focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-opacity"
    >
      <Pencil className="h-3 w-3" />
    </button>
  );
}

export function EditedDot() {
  return (
    <span
      className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-attention"
      title="Editado manualmente"
    />
  );
}

export function AperturaDot() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-info" />
      </TooltipTrigger>
      <TooltipContent>Apertura de gastos aplicada</TooltipContent>
    </Tooltip>
  );
}

export function toEditString(value: string | number | null | undefined): string {
  return value != null ? String(value) : "";
}
