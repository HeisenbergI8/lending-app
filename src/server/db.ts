import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

/**
 * The one Prisma client for the whole app.
 *
 * Server-only. Nothing under src/app/ that runs in the browser may import this,
 * directly or transitively — it holds the database credentials.
 *
 * Two things this file exists to get right:
 *
 * 1. ONE INSTANCE. Next.js hot-reload re-evaluates modules on every edit. A
 *    client constructed at module scope would therefore be constructed again on
 *    every save, each one holding its own connection pool, until Postgres refuses
 *    new connections and the dev server starts failing for no visible reason.
 *    Stashing it on globalThis in development is the standard fix.
 *
 * 2. THE POOLED URL. Serverless functions open a connection per invocation, and
 *    the session connection runs out of slots quickly under that pattern. So the
 *    app uses DATABASE_URL — Supabase's transaction pooler on 6543 — while
 *    DIRECT_URL (5432) is reserved for the CLI's migrations. The names follow
 *    Supabase's own, so their dashboard strings drop straight into .env.
 */

function connectionString(): string {
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error('DATABASE_URL is not set. See .env.example.')
  }
  return url
}

function createClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: connectionString() })
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  })
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const db: PrismaClient = globalForPrisma.prisma ?? createClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db
}
