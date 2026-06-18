"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { AlertCircle } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4 flex-shrink-0" aria-hidden="true">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

interface LoginFormProps {
  next: string;
  hasError: boolean;
}

export function LoginForm({ next, hasError }: LoginFormProps) {
  const [loading, setLoading] = useState(false);
  const supabase = useMemo(() => createClient(), []);

  async function handleGoogleLogin() {
    setLoading(true);
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
        scopes: "openid email profile https://www.googleapis.com/auth/drive.readonly",
        queryParams: {
          // "consent" fuerza re-emisión del refresh_token en cada login,
          // necesario para recuperar acceso si el token fue revocado.
          prompt: "select_account",
          access_type: "offline",
        },
      },
    });

    if (error) {
      // Solo llega aquí si hay error — si no, el SDK redirige al provider
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      {hasError && (
        <div className="flex items-start gap-3 rounded-lg border border-destructive/25 bg-destructive/10 p-3">
          <AlertCircle className="size-4 text-destructive flex-shrink-0 mt-0.5" />
          <p className="text-sm text-destructive leading-snug">
            Error al autenticar con Google. Intentá nuevamente.
          </p>
        </div>
      )}

      <button
        onClick={handleGoogleLogin}
        disabled={loading}
        className="w-full flex items-center justify-center gap-3 h-11 px-4 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 text-sm font-medium shadow-sm transition-all duration-150 hover:bg-zinc-50 dark:hover:bg-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-50 dark:focus-visible:ring-offset-zinc-900 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? (
          <Spinner />
        ) : (
          <GoogleIcon />
        )}
        <span>{loading ? "Redirigiendo..." : "Continuar con Google"}</span>
      </button>
    </div>
  );
}
