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
 * DATABASE_URL here must be Supabase's DIRECT connection (port 5432), not the
 * pooled one. Migrations take advisory locks and run DDL, which a transaction
 * pooler cannot carry.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
  },
  migrations: {
    seed: 'node prisma/seed/demo.ts',
  },
})
