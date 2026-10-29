"use client";
import { create } from "zustand";
import type { PedidoCarga } from "@/lib/dashboard/carga-desde-celda";

// Pedido de carga desde una celda vacía del pivot; lo atiende CargarFactura (que tiene los maestros).
export const useCargaDesdeCelda = create<{ pedido: PedidoCarga | null; pedir: (p: PedidoCarga) => void; limpiar: () => void }>((set) => ({
  pedido: null,
  pedir: (pedido) => set({ pedido }),
  limpiar: () => set({ pedido: null }),
}));
