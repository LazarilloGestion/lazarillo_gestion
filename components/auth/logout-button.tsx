import { logout } from "@/app/actions/auth";
import { LogOut } from "lucide-react";

export function LogoutButton() {
  return (
    <form action={logout}>
      <button
        type="submit"
        className="flex items-center gap-2 w-full px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground rounded-md hover:bg-accent transition-colors cursor-pointer"
      >
        <LogOut className="size-4 shrink-0" />
        <span className="group-data-[collapsible=icon]:hidden">
          Cerrar sesión
        </span>
      </button>
    </form>
  );
}
