import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL requerida"),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url("NEXT_PUBLIC_SUPABASE_URL debe ser una URL válida"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1, "NEXT_PUBLIC_SUPABASE_ANON_KEY requerida"),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, "SUPABASE_SERVICE_ROLE_KEY requerida"),
});

export const env = (() => {
  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    const msgs = result.error.issues
      .map((issue) => `  ${String(issue.path[0])}: ${issue.message}`)
      .join("\n");
    throw new Error(`Variables de entorno faltantes o inválidas:\n${msgs}`);
  }
  return result.data;
})();
