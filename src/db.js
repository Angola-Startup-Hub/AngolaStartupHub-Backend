import { PrismaClient } from "@prisma/client";

// Neon pooled (pgbouncer) + serverless: 1 ligação por instância e sem prepared statements
function url() {
  const u = process.env.DATABASE_URL;
  if (!u || !u.includes("-pooler")) return u;
  const x = new URL(u);
  x.searchParams.set("pgbouncer", "true");
  x.searchParams.set("connection_limit", "1");
  return x.toString();
}

// Reutiliza o cliente entre invocações serverless "quentes"
export const prisma = (globalThis.__prisma ??= new PrismaClient(url() ? { datasources: { db: { url: url() } } } : {}));
