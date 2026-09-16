"use client";
import { SidebarProvider } from "@/components/ui/sidebar";
import { useSidebarPersisted } from "@/hooks/use-dashboard-store";

// Conecta el SidebarProvider de shadcn (components/ui/sidebar.tsx) al store
// de zustand: sidebarOpen se seedea sincrónicamente desde localStorage
// (readPersistedField, ver hooks/use-dashboard-store.ts), así que este
// wrapper no necesita ninguna fase de "seed" propia — el valor ya es
// correcto desde el primer render de cliente.
export function AppSidebarProvider({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const { sidebarOpen, setSidebarOpen } = useSidebarPersisted();
  return (
    <SidebarProvider className={className} open={sidebarOpen} onOpenChange={setSidebarOpen}>
      {children}
    </SidebarProvider>
  );
}
