import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "@/lib/env";

// Direct connection (no PgBouncer) required for long ETL transactions.
// DATABASE_URL uses pgbouncer=true (transaction pooling) which breaks tx >30s.
// DIRECT_URL points to session-mode pooler or direct server.
const g = globalThis as unknown as { _prismaEtl?: PrismaClient };

export function getEtlClient(): PrismaClient {
  if (!g._prismaEtl) {
    const url = env.DIRECT_URL ?? env.DATABASE_URL;
    g._prismaEtl = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  }
  return g._prismaEtl;
}
