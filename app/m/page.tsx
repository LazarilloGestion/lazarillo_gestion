import type { Metadata } from "next";
import { AppMovil } from "@/components/movil/app-movil";

// Lazarillo en el celular (Diego 27/10/2026). Va fuera del shell (sin barra lateral).
export const metadata: Metadata = { title: "Lazarillo" };

export default function MovilPage() {
  return <AppMovil />;
}
