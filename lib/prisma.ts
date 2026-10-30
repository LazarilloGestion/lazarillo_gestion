import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "./env";

// Conexión directa a Postgres — nunca pasa por PostgREST, así que el RLS de
// Supabase no aplica a nada de lo que se consulte con este cliente. Ver SECURITY.md.

const g = globalThis as unknown as { _prisma?: PrismaClient };

function getClient(): PrismaClient {
  if (!g._prisma) {
    // Pocas conexiones por instancia (Diego 30/10/2026: "Vercel no me carga" = ECHECKOUTTIMEOUT del pooler de
    // Supabase). Al abrir el Panel se disparan muchas funciones a la vez y cada una abría hasta 10 conexiones
    // (el default de pg) con sus Promise.all: el pool de Supabase se llenaba y todo esperaba 60 s. Con 3 por
    // instancia las consultas de una misma función esperan en la función, no en la base.
    const adapter = new PrismaPg({ connectionString: env.DATABASE_URL, max: 3, idleTimeoutMillis: 10_000 });
    g._prisma = new PrismaClient({ adapter });
  }
  return g._prisma;
}

// Lazy proxy — env.DATABASE_URL is not accessed at import time (build-safe).
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_, prop: string | symbol) {
    const client = getClient();
    const val = (client as unknown as Record<string | symbol, unknown>)[prop];
    return typeof val === "function" ? (val as (...a: unknown[]) => unknown).bind(client) : val;
  },
});
