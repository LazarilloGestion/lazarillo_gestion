import type { Metadata } from "next";
import { AppMovil } from "@/components/movil/app-movil";

// Lazarillo en el celular (Diego 27/10/2026). Va fuera del shell (sin barra lateral).
// Manifest propio: "Agregar a inicio" desde /m abre /m (el de la raíz abre /dashboard; Diego 28/10).
export const metadata: Metadata = {
  title: "Lazarillo",
  manifest: "/manifest-m.webmanifest",
  appleWebApp: { capable: true, title: "Lazarillo", statusBarStyle: "default" },
};

export default function MovilPage() {
  return <AppMovil />;
}
