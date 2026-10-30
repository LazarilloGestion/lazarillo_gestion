import { SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { AppSidebarProvider } from "@/components/app-sidebar-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { ActividadCampana } from "@/components/actividad-campana";
import { DashboardFiltersToggle } from "@/components/dashboard/dashboard-filters-toggle";
import { getAuthUser } from "@/lib/auth/get-user";
import { buildBootstrapScript } from "@/lib/ui-persistence/bootstrap-script";
import { saltoPanel } from "@/lib/salto-panel";
import { ArrowUpRight } from "lucide-react";

// Corrige data-state/data-collapsible del sidebar ANTES de hidratar,
// reutilizando los mismos atributos que components/ui/sidebar.tsx ya
// gestiona — así el 100% del CSS existente de shadcn (group-data-[collapsible=icon]:...)
// sigue funcionando sin duplicar un solo selector. No puede ir en <head>
// como el de app/layout.tsx porque el nodo [data-slot="sidebar"] recién
// existe una vez que el <body> se parseó hasta acá.
const sidebarBootstrapScript = buildBootstrapScript([
  {
    storageKey: "dashboard:state",
    statePath: "state.sidebarOpen",
    target: { querySelector: '[data-slot="sidebar"]' },
    attrs: [
      { name: "data-state", map: { false: "collapsed" }, default: "expanded" },
      { name: "data-collapsible", map: { false: "icon" }, default: "" },
    ],
  },
]);

export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  const user = await getAuthUser();
  const salto = saltoPanel(user?.email);

  return (
    <AppSidebarProvider className="h-svh">
      <AppSidebar user={user} />
      <script dangerouslySetInnerHTML={{ __html: sidebarBootstrapScript }} />
      <div className="flex flex-col flex-1 min-w-0 min-h-0">
        <header className="h-12 flex items-center px-3 border-b bg-background sticky top-0 z-30 gap-2">
          <SidebarTrigger className="h-8 w-8 shrink-0" />
          <span className="sm:hidden text-sm font-semibold tracking-tight">
            Lazarillo <span className="text-muted-foreground font-normal">Gestión</span>
          </span>
          <div className="ml-auto flex items-center gap-1">
            {salto && (
              <a href={salto.href} className="mr-1 inline-flex h-8 items-center gap-1 rounded-lg border border-zinc-200 dark:border-zinc-700 px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground">
                {salto.label} <ArrowUpRight className="h-3.5 w-3.5" />
              </a>
            )}
            <DashboardFiltersToggle />
            <ThemeToggle />
            {/* Campanita de Actividad, a la derecha de la luna (Diego, 27/10/2026). */}
            <ActividadCampana />
          </div>
        </header>

        <main className="flex-1 min-h-0 overflow-auto bg-muted/20">
          {children}
        </main>
      </div>
    </AppSidebarProvider>
  );
}
