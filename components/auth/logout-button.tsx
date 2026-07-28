"use client";

import { useState, useTransition } from "react";
import { logout } from "@/app/actions/auth";
import { LogOut } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export function LogoutButton() {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleConfirm() {
    startTransition(() => logout());
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 w-full px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground rounded-md hover:bg-accent transition-colors cursor-pointer"
      >
        <LogOut className="size-4 shrink-0" />
        <span className="group-data-[collapsible=icon]:hidden">
          Cerrar sesión
        </span>
      </button>

      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="¿Cerrar sesión?"
        description="Serás redirigido a la pantalla de inicio de sesión."
        confirmLabel={pending ? "Cerrando…" : "Cerrar sesión"}
        destructive
        confirming={pending}
        onConfirm={handleConfirm}
      />
    </>
  );
}
