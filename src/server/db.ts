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

function client(): PrismaClient {
  const existing = globalForPrisma.prisma
  if (existing) return existing

  const created = createClient()
  if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = created
  return created
}

/**
 * Built on first use, not on import.
 *
 * A client constructed at module scope would demand DATABASE_URL the moment
 * anything imported this file — including a unit test of a pure function three
 * imports away, and Next's build step collecting page data in an environment
 * that has no database. Both would fail for a reason unrelated to what they were
 * doing. The proxy defers construction to the first actual query.
 */
export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property, receiver) {
    return Reflect.get(client() as object, property, receiver)
  },
  has(_target, property) {
    return Reflect.has(client() as object, property)
  },
})
