"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// Block de notas del menú lateral: texto libre por usuario, guardado en la
// base (se ve igual en cualquier navegador). Se guarda solo, al dejar de tipear.
type Estado = "cargando" | "listo" | "guardando" | "guardado" | "error";

export function NotasSidebar() {
  const [texto, setTexto] = useState("");
  const [estado, setEstado] = useState<Estado>("cargando");
  const ultimoGuardado = useRef("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch("/api/notas")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { texto: string }) => {
        if (!vivo) return;
        setTexto(j.texto ?? "");
        ultimoGuardado.current = j.texto ?? "";
        setEstado("listo");
      })
      .catch(() => vivo && setEstado("error"));
    return () => { vivo = false; };
  }, []);

  async function guardar(valor: string) {
    if (valor === ultimoGuardado.current) return;
    setEstado("guardando");
    try {
      const r = await fetch("/api/notas", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ texto: valor }),
      });
      if (!r.ok) throw new Error(String(r.status));
      ultimoGuardado.current = valor;
      setEstado("guardado");
    } catch {
      setEstado("error");
    }
  }

  function cambiar(valor: string) {
    setTexto(valor);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void guardar(valor), 800);
  }

  const leyenda = estado === "cargando" ? "Cargando…"
    : estado === "guardando" ? "Guardando…"
    : estado === "guardado" ? "Guardado"
    : estado === "error" ? "No se pudo guardar"
    : "";

  return (
    <div className="px-2 pb-2">
      <div className="flex items-center justify-between px-2 pb-1.5 text-xs font-medium text-sidebar-foreground/70">
        <span>Notas</span>
        <span className={cn("text-[10px] font-normal", estado === "error" ? "text-red-600" : "text-muted-foreground")}>{leyenda}</span>
      </div>
      <textarea
        value={texto}
        disabled={estado === "cargando"}
        onChange={(e) => cambiar(e.target.value)}
        onBlur={() => { if (timer.current) clearTimeout(timer.current); void guardar(texto); }}
        placeholder="Anotaciones rápidas…"
        maxLength={20000}
        className="block w-full min-h-[10rem] resize-y rounded-md border border-sidebar-border bg-background px-2.5 py-2 text-[13px] leading-snug outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
      />
    </div>
  );
}
