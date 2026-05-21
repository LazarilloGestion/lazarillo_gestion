import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { getAuthUser } from "@/lib/auth/get-user";

export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  const user = await getAuthUser();

  return (
    <SidebarProvider className="h-svh">
      <AppSidebar user={user} />
      <div className="flex flex-col flex-1 min-w-0 min-h-0">
        <header className="h-12 flex items-center px-3 border-b bg-background sticky top-0 z-30 gap-2">
          <SidebarTrigger className="h-8 w-8 shrink-0" />
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
          </div>
        </header>

        <main className="flex-1 min-h-0 overflow-auto bg-muted/20">
          {children}
        </main>
      </div>
    </SidebarProvider>
  );
}
