"use client";
import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { X } from "lucide-react";
import { montoDesdePct, pctDesdeMonto } from "@/lib/apertura/conversion";
import { formatearMonto, formatearMontoTipeado, parsearMonto, posicionTrasFormatear } from "@/lib/apertura/formato-monto";
import { destinosSuperpuestos, type DestinoBasico } from "@/lib/apertura/validaciones";
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

  // ¿Alguna otra fila ya usa un destino que compite por la misma plata que
  // `candidato` acá? (ver destinosSuperpuestos).
  function superpuestoConOtraFila(candidato: DestinoBasico): boolean {
    return otrosDestinos.some((o) => destinosSuperpuestos(candidato, o));
  }
  const todoElLocalDeshabilitado =
    destino.localId != null && superpuestoConOtraFila({ localId: destino.localId, puntoDeVentaId: null });
  function puntoDeVentaDeshabilitado(puntoDeVentaId: number): boolean {
    return superpuestoConOtraFila({ localId: destino.localId, puntoDeVentaId });
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
  const [montoDraft, setMontoDraft] = useState(() => (monto !== null ? formatearMonto(monto) : ""));

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
    setMontoDraft(monto !== null ? formatearMonto(monto) : "");
  }

  function desenfocar(campo: "pct" | "monto") {
    // Solo limpia si sigue siendo el campo activo — evita la carrera cuando el
    // focus ya saltó al otro input antes de que llegue este blur.
    setCampoActivo((prev) => (prev === campo ? null : prev));
    // Al salir, el campo vuelve al valor canónico: un borrador a medio tipear
    // ("" o "12.") nunca se llegó a commitear hacia arriba y quedaría mostrando
    // algo distinto del estado real del destino.
    if (campo === "pct") setPctDraft(String(destino.porcentaje));
    else setMontoDraft(monto !== null ? formatearMonto(monto) : "");
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

  function handleMontoChange(input: HTMLInputElement) {
    const crudo = input.value;
    const formateado = formatearMontoTipeado(crudo);
    setMontoDraft(formateado);

    // El texto se reformatea en cada tecla (puntos de miles), lo que manda el
    // cursor al final; se lo devuelve al mismo dígito después del render.
    const significativosAntes = crudo.slice(0, input.selectionStart ?? crudo.length).replace(/[^\d,]/g, "").length;
    const cursor = posicionTrasFormatear(formateado, significativosAntes);
    requestAnimationFrame(() => input.setSelectionRange(cursor, cursor));

    if (total === null) return;
    if (formateado === "") {
      onChange({ ...destino, porcentaje: 0 });
      return;
    }
    const valor = parsearMonto(formateado);
    if (valor === null) return;
    onChange({ ...destino, porcentaje: pctDesdeMonto(valor, total) });
  }

  // Sin flechitas nativas del type="number": en Chrome/Safari le restan ancho
  // útil al campo por dentro sin que se note, y eran parte de por qué el monto
  // (hasta 11-12 dígitos con totales reales en ARS) aparecía cortado.
  const sinSpinner =
    "[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";

  return (
    <div className="flex items-center gap-2">
      <Select
        value={destino.localId != null ? String(destino.localId) : ""}
        onValueChange={(v) => onChange({ ...destino, localId: Number(v), puntoDeVentaId: null })}
      >
        <SelectTrigger className="w-28 shrink-0 text-xs" size="sm">
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
        <SelectTrigger className="w-28 shrink-0 text-xs" size="sm">
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

      <div className="flex shrink-0 items-center gap-1">
        <Input
          type="number"
          step="0.01"
          min={0}
          max={100}
          className={`h-7 w-16 text-xs text-right ${sinSpinner}`}
          value={pctDraft}
          onFocus={() => setCampoActivo("pct")}
          onBlur={() => desenfocar("pct")}
          onChange={(e) => handlePctChange(e.target.value)}
        />
        <span className="text-xs text-muted-foreground">%</span>
      </div>

      {/* flex-1: el monto puede tener cualquier cantidad de dígitos según el
          total del período, así que toma todo el espacio que sobra en la fila
          (hay de sobra: Local/PDV/% ya tienen su ancho fijo) en vez de un
          w-24 arbitrario que se queda corto con totales grandes. */}
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <Input
          type="text"
          inputMode="decimal"
          className="h-7 min-w-0 flex-1 text-xs text-right"
          // Sin total conocido no hay contra qué convertir: se muestra "—" en
          // vez de un $0 que parecería dato real (mismo criterio que el total
          // agregado del modal).
          placeholder="—"
          disabled={total === null}
          value={total === null ? "" : montoDraft}
          onFocus={() => setCampoActivo("monto")}
          onBlur={() => desenfocar("monto")}
          onChange={(e) => handleMontoChange(e.target)}
        />
        <span className="shrink-0 text-xs text-muted-foreground">$</span>
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
