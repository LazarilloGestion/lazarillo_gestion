import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "./env";

// Conexión directa a Postgres — nunca pasa por PostgREST, así que el RLS de
// Supabase no aplica a nada de lo que se consulte con este cliente. Ver SECURITY.md.

const g = globalThis as unknown as { _prisma?: PrismaClient };

function getClient(): PrismaClient {
  if (!g._prisma) {
    const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
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
