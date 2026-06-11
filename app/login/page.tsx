import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = {
  title: "Iniciar sesión | Lazarillo Gestión",
};

interface Props {
  searchParams: Promise<{ next?: string; error?: string }>;
}

export default async function LoginPage({ searchParams }: Props) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) redirect("/dashboard");

  const params = await searchParams;

  return (
    <div className="min-h-svh grid lg:grid-cols-2">
      {/* Panel izquierdo — identidad */}
      <div className="hidden lg:flex flex-col justify-between bg-zinc-950 p-12 relative overflow-hidden">
        {/* Grid decorativo de fondo */}
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              "linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />
        {/* Glow accent */}
        <div className="absolute top-0 left-0 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2" />

        {/* Logo */}
        <div className="relative z-10 flex items-center gap-3">
          <div className="w-8 h-8 bg-white rounded-sm flex items-center justify-center flex-shrink-0">
            <span className="text-zinc-950 text-xs font-bold font-mono tracking-tighter">
              LG
            </span>
          </div>
          <span className="text-white/90 text-sm font-medium tracking-wide">
            Lazarillo Gestión
          </span>
        </div>

        {/* Copy central */}
        <div className="relative z-10 space-y-6">
          <div className="space-y-3">
            <p className="text-zinc-500 text-xs font-mono uppercase tracking-widest">
              Sistema de gestión operativa
            </p>
            <h2 className="text-white text-4xl font-semibold leading-tight tracking-tight">
              Visibilidad total
              <br />
              sobre tu operación.
            </h2>
          </div>
          <p className="text-zinc-400 text-sm leading-relaxed max-w-xs">
            Gestión e importación de datos, todo en un solo lugar.
          </p>
        </div>

        {/* Footer del panel */}
        <div className="relative z-10">
          <p className="text-zinc-600 text-xs font-mono">
            © {new Date().getFullYear()} Lazarillo Gestión
          </p>
        </div>
      </div>

      {/* Panel derecho — formulario */}
      <div className="flex flex-col items-center justify-center bg-zinc-50 dark:bg-zinc-900 p-8">
        {/* Logo mobile */}
        <div className="lg:hidden flex items-center gap-3 mb-10">
          <div className="w-8 h-8 bg-zinc-950 dark:bg-white rounded-sm flex items-center justify-center">
            <span className="text-white dark:text-zinc-950 text-xs font-bold font-mono">
              LG
            </span>
          </div>
          <span className="text-zinc-900 dark:text-white text-sm font-medium">
            Lazarillo Gestión
          </span>
        </div>

        <div className="w-full max-w-sm space-y-8">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-white">
              Bienvenido
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Accedé con tu cuenta corporativa para continuar
            </p>
          </div>

          <LoginForm
            next={params.next ?? "/dashboard"}
            hasError={params.error === "auth_callback_error"}
          />

          <p className="text-xs text-zinc-400 dark:text-zinc-600 text-center">
            Solo cuentas autorizadas por la organización.
          </p>
        </div>
      </div>
    </div>
  );
}
