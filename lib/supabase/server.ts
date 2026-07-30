import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env } from "@/lib/env";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Patrón oficial de @supabase/ssr: cookieStore.set() lanza si se
            // llama desde un Server Component (sólo Server Actions/Route
            // Handlers pueden setear cookies). No es un error real — proxy.ts
            // ya refresca la sesión en cada request vía el middleware.
          }
        },
      },
    }
  );
}
