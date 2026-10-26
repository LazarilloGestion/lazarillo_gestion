"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Upload, Tags } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { LogoutButton } from "@/components/auth/logout-button";
import { NotasSidebar } from "@/components/notas-sidebar";

const NAV = [
  { href: "/dashboard", label: "Panel de Gestión", icon: LayoutDashboard },
  { href: "/importar", label: "Importar datos", icon: Upload },
  { href: "/conceptos", label: "Conceptos de caja", icon: Tags },
];

export function AppSidebar({ user }: { user: User | null }) {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();

  const avatarUrl = user?.user_metadata?.avatar_url as string | undefined;
  const displayName = (user?.user_metadata?.full_name as string | undefined) ?? user?.email ?? "Usuario";
  const email = user?.email ?? "";
  const initials = email.slice(0, 2).toUpperCase() || "?";

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="h-12 flex flex-row items-center px-4 border-b">
        <div className="flex items-center gap-2 group-data-[collapsible=icon]:justify-center">
          <div className="w-6 h-6 rounded bg-foreground flex items-center justify-center shrink-0">
            <span className="text-background text-[10px] font-bold">LG</span>
          </div>
          <span className="font-semibold text-sm tracking-tight group-data-[collapsible=icon]:hidden">
            Lazarillo <span className="text-muted-foreground font-normal">Gestión</span>
          </span>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navegación</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map(({ href, label, icon: Icon }) => (
                <SidebarMenuItem key={href}>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname === href}
                    tooltip={label}
                  >
                    <Link href={href} onClick={() => setOpenMobile(false)}>
                      <Icon />
                      <span>{label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Block de notas: solo con el menú abierto. */}
        <div className="mt-2 group-data-[collapsible=icon]:hidden">
          <NotasSidebar />
        </div>
      </SidebarContent>

      <SidebarFooter className="border-t p-2 space-y-1">
        <div className="flex items-center gap-2.5 px-2 py-1.5 rounded-md group-data-[collapsible=icon]:justify-center">
          <div className="w-7 h-7 rounded-full overflow-hidden bg-foreground flex items-center justify-center shrink-0">
            {avatarUrl ? (
              <Image
                src={avatarUrl}
                alt="Avatar"
                width={28}
                height={28}
                className="object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <span className="text-background text-xs font-semibold">
                {initials}
              </span>
            )}
          </div>
          <div className="flex flex-col min-w-0 group-data-[collapsible=icon]:hidden">
            <span className="text-xs font-medium truncate">{displayName}</span>
            <span className="text-[11px] text-muted-foreground truncate">{email}</span>
          </div>
        </div>
        <LogoutButton />
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
