"use client";
import { Check, X, Pencil } from "lucide-react";

export function EditActionButtons({
  onSave,
  onCancel,
  saving,
}: {
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  return (
    <div className="flex items-center gap-1">
      <button
        onClick={onSave}
        disabled={saving}
        className="flex h-6 w-6 items-center justify-center rounded text-emerald-600 hover:bg-emerald-500/10 disabled:opacity-40"
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
      className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-muted transition-opacity"
    >
      <Pencil className="h-3 w-3" />
    </button>
  );
}

export function EditedDot() {
  return (
    <span
      className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-orange-400"
      title="Editado manualmente"
    />
  );
}

export function toEditString(value: string | number | null | undefined): string {
  return value != null ? String(value) : "";
}
