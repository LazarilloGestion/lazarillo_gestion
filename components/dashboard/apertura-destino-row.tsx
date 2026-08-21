"use client";
import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { X } from "lucide-react";
import { montoDesdePct, pctDesdeMonto } from "@/lib/apertura/conversion";
import type { DestinoBasico } from "@/lib/apertura/validaciones";
import type { Local } from "@/lib/types/domain";

export interface DestinoFormState {
  localId: number | null;
  puntoDeVentaId: number | null;
  porcentaje: number;
}

const TODO_EL_LOCAL = "__todo_el_local";

function esNumeroValido(texto: string): boolean {
  if (texto.trim() === "") return false;
  return Number.isFinite(Number(texto));
}

export function AperturaDestinoRow({
  destino,
  locales,
  total,
  otrosDestinos,
  onChange,
  onRemove,
  removable,
}: {
  destino: DestinoFormState;
  locales: Local[];
  /** null = el total del período todavía no se conoce (preview cargando/deshabilitado). */
  total: number | null;
  /** Destinos de las OTRAS filas del formulario — para deshabilitar acá cualquier combinación que se superponga (ver destinosSuperpuestos). */
  otrosDestinos: DestinoBasico[];
  onChange: (next: DestinoFormState) => void;
  onRemove: () => void;
  removable: boolean;
}) {
  const localSeleccionado = locales.find((l) => l.id === destino.localId);
  const puntosDeVenta = localSeleccionado?.puntosDeVenta ?? [];
  const monto = total !== null ? montoDesdePct(destino.porcentaje, total) : null;

  // Otras filas que ya usan el MISMO local — cualquiera de ellas (sea "todo
  // el local" o un punto de venta específico) compite por la misma plata que
  // "todo el local" acá, así que basta con que exista una para bloquearlo.
  const otrasDelMismoLocal = destino.localId != null ? otrosDestinos.filter((o) => o.localId === destino.localId) : [];
  const todoElLocalDeshabilitado = otrasDelMismoLocal.length > 0;
  function puntoDeVentaDeshabilitado(puntoDeVentaId: number): boolean {
    return otrasDelMismoLocal.some((o) => o.puntoDeVentaId === null || o.puntoDeVentaId === puntoDeVentaId);
  }

  // Campo %↔$ bidireccional: cada input tiene su propio borrador de texto que
  // es la fuente de verdad MIENTRAS ese campo está enfocado. Sin esto, con
  // totales reales en ARS (millones) cada tecla se re-derivaba vía
  // pctDesdeMonto (resolución de 2 decimales de %), que colapsaba a 0 los
  // valores intermedios y devolvía el campo a "0" a mitad del tipeo — el
  // usuario solo podía pegar, no tipear (hallazgo de la revisión final de
  // rama, Fase C).
  const [campoActivo, setCampoActivo] = useState<"pct" | "monto" | null>(null);
  const [pctDraft, setPctDraft] = useState(() => String(destino.porcentaje));
  const [montoDraft, setMontoDraft] = useState(() => (monto !== null ? String(monto) : ""));

  // Re-sincronización de borradores desde las props: ajuste durante el render
  // (mismo patrón que apertura-gastos-modal.tsx usa para resetear estado) en
  // vez de useEffect, y salteando siempre el campo enfocado para no pelear
  // contra lo que el usuario está tipeando.
  const [pctSincronizado, setPctSincronizado] = useState(destino.porcentaje);
  if (campoActivo !== "pct" && pctSincronizado !== destino.porcentaje) {
    setPctSincronizado(destino.porcentaje);
    setPctDraft(String(destino.porcentaje));
  }
  const [montoSincronizado, setMontoSincronizado] = useState(monto);
  if (campoActivo !== "monto" && montoSincronizado !== monto) {
    setMontoSincronizado(monto);
    setMontoDraft(monto !== null ? String(monto) : "");
  }

  function desenfocar(campo: "pct" | "monto") {
    // Solo limpia si sigue siendo el campo activo — evita la carrera cuando el
    // focus ya saltó al otro input antes de que llegue este blur.
    setCampoActivo((prev) => (prev === campo ? null : prev));
    // Al salir, el campo vuelve al valor canónico: un borrador a medio tipear
    // ("" o "12.") nunca se llegó a commitear hacia arriba y quedaría mostrando
    // algo distinto del estado real del destino.
    if (campo === "pct") setPctDraft(String(destino.porcentaje));
    else setMontoDraft(monto !== null ? String(monto) : "");
  }

  function handlePctChange(texto: string) {
    setPctDraft(texto);
    // Vacío se commitea como 0 — si no, al desenfocar el campo "vuelve" al
    // último valor no vacío (ver desenfocar) y el usuario nunca logra borrarlo,
    // solo sobreescribirlo.
    if (texto.trim() === "") {
      onChange({ ...destino, porcentaje: 0 });
      return;
    }
    if (!esNumeroValido(texto)) return;
    onChange({ ...destino, porcentaje: Number(texto) });
  }

  function handleMontoChange(texto: string) {
    setMontoDraft(texto);
    if (total === null) return;
    if (texto.trim() === "") {
      onChange({ ...destino, porcentaje: 0 });
      return;
    }
    if (!esNumeroValido(texto)) return;
    onChange({ ...destino, porcentaje: pctDesdeMonto(Number(texto), total) });
  }

  return (
    <div className="flex items-center gap-3">
      <Select
        value={destino.localId != null ? String(destino.localId) : ""}
        onValueChange={(v) => onChange({ ...destino, localId: Number(v), puntoDeVentaId: null })}
      >
        <SelectTrigger className="h-8 w-32 text-xs" size="sm">
          <SelectValue placeholder="Local" />
        </SelectTrigger>
        <SelectContent>
          {locales.map((l) => (
            <SelectItem key={l.id} value={String(l.id)} className="text-xs">
              {l.nombre}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={destino.puntoDeVentaId != null ? String(destino.puntoDeVentaId) : TODO_EL_LOCAL}
        onValueChange={(v) => onChange({ ...destino, puntoDeVentaId: v === TODO_EL_LOCAL ? null : Number(v) })}
        disabled={!localSeleccionado}
      >
        <SelectTrigger className="h-8 w-32 text-xs" size="sm">
          <SelectValue placeholder="Punto de venta" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={TODO_EL_LOCAL} className="text-xs" disabled={todoElLocalDeshabilitado}>
            Todo el local
          </SelectItem>
          {puntosDeVenta.map((p) => (
            <SelectItem key={p.id} value={String(p.id)} className="text-xs" disabled={puntoDeVentaDeshabilitado(p.id)}>
              {p.nombre}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex items-center gap-1">
        <Input
          type="number"
          step="0.01"
          min={0}
          max={100}
          className="h-8 w-16 text-xs text-right"
          value={pctDraft}
          onFocus={() => setCampoActivo("pct")}
          onBlur={() => desenfocar("pct")}
          onChange={(e) => handlePctChange(e.target.value)}
        />
        <span className="text-xs text-muted-foreground">%</span>
      </div>

      <div className="flex items-center gap-1">
        <Input
          type="number"
          step="0.01"
          className="h-8 w-24 text-xs text-right"
          // Sin total conocido no hay contra qué convertir: se muestra "—" en
          // vez de un $0 que parecería dato real (mismo criterio que el total
          // agregado del modal).
          placeholder="—"
          disabled={total === null}
          value={total === null ? "" : montoDraft}
          onFocus={() => setCampoActivo("monto")}
          onBlur={() => desenfocar("monto")}
          onChange={(e) => handleMontoChange(e.target.value)}
        />
        <span className="text-xs text-muted-foreground">$</span>
      </div>

      <button
        type="button"
        onClick={onRemove}
        disabled={!removable}
        title={removable ? "Quitar destino" : "Tiene que quedar al menos un destino"}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted disabled:opacity-30 disabled:pointer-events-none"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
