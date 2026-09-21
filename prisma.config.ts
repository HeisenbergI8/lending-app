import { defineConfig, env } from 'prisma/config'

// Prisma 7 no longer reads .env by itself. Node 22 can, with no dependency.
// Wrapped because CI and Vercel supply real environment variables and have no
// .env file — a missing file there is correct, not an error.
try {
  process.loadEnvFile()
} catch {
  // no .env on disk; rely on the real environment
}

/**
 * Prisma CLI configuration — migrations, introspection and seeding.
 *
 * As of Prisma 7 the connection URL no longer lives in schema.prisma. This file
 * is read by the CLI only; the running application builds its own connection
 * through a driver adapter in src/server/db.ts.
 *
 * Naming follows Supabase's own convention, so a string copied from their
 * dashboard drops straight in: DATABASE_URL is the POOLED connection used by the
 * app, DIRECT_URL the SESSION one used here.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    // DIRECT_URL is the session-mode connection (5432). Migrations take advisory
    // locks and run DDL, which the transaction pooler on 6543 cannot carry.
    url: env('DIRECT_URL'),
  },
  migrations: {
    seed: 'node prisma/seed/demo.ts',
  },
})
