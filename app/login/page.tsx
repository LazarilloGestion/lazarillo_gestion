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
    <div className="min-h-svh flex items-center justify-center bg-muted/20 p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="w-10 h-10 rounded-lg bg-foreground flex items-center justify-center">
            <span className="text-background text-sm font-bold">LG</span>
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              Lazarillo Gestión
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Sistema de gestión operativa
            </p>
          </div>
        </div>

        <LoginForm
          next={params.next ?? "/dashboard"}
          hasError={params.error === "auth_callback_error"}
        />
      </div>
    </div>
  );
}
