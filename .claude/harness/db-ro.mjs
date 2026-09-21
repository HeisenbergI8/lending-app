#!/usr/bin/env node
// Read-only database access for reconciliation work.
//
//   node .claude/harness/db-ro.mjs --grants          what this connection may actually do
//   node .claude/harness/db-ro.mjs "SELECT ..."      run one read-only statement
//
// Credentials come from .env and are never printed. Preference order:
//
//   DB_RO_URL    a genuinely SELECT-only role, if one was ever created. Best.
//   DIRECT_URL   Supabase session connection, port 5432. What this normally uses.
//   DATABASE_URL the pooled connection the app runs on, port 6543. Last resort —
//                every ad-hoc query here competes with the app for pooler slots.
//
// ── WHY A SCRIPT AND NOT `prisma studio` OR A PRISMA SCRIPT ────────────────────
//
// The whole point of a reconciliation query is that it is derived from the LABEL's promise,
// independently of the code. A query written through the same Prisma client the screen uses
// inherits the same soft-delete default, the same userId scoping and the same includes — so
// it agrees with the screen by construction and proves nothing. This talks to Postgres directly.
//
// ── READ-ONLY IS ENFORCED TWICE ────────────────────────────────────────────────
//
//   1. The statement must start with SELECT / WITH / SHOW / EXPLAIN / TABLE, and may not
//      carry a second statement.
//   2. It runs inside `BEGIN ... READ ONLY`, which Postgres itself enforces, and the
//      transaction is ROLLBACKed either way.
//
// Two things must fail before this can change data. Note that (1) alone is not enough: a
// `WITH x AS (DELETE ... RETURNING *) SELECT * FROM x` starts with WITH and writes. The
// read-only transaction is what actually stops that one.

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

// ── .env, parsed here rather than with a dependency ────────────────────────────
//
// Values may be quoted — the Supabase dashboard hands out quoted URLs and .env.example
// carries them that way — so strip one matching pair of quotes.
const readEnv = () => {
  let text

  try {
    text = readFileSync('.env', 'utf8')
  } catch {
    console.error('No .env in this directory. Run this from the repository root.')
    process.exit(1)
  }

  return Object.fromEntries(
    text
      .split('\n')
      .filter(line => /^\s*[A-Z_][A-Z0-9_]*\s*=/.test(line))
      .map(line => {
        const i = line.indexOf('=')
        const key = line.slice(0, i).trim()
        const raw = line.slice(i + 1).trim()

        return [key, raw.replace(/^(['"])([\s\S]*)\1$/, '$2')]
      })
  )
}

const env = readEnv()
const source = ['DB_RO_URL', 'DIRECT_URL', 'DATABASE_URL'].find(key => env[key])

if (!source) {
  console.error('None of DB_RO_URL, DIRECT_URL, DATABASE_URL are set in .env. See .env.example.')
  process.exit(1)
}

const connectionString = env[source]

// The password is the one thing in that URL worth hiding. Everything printed from here on
// goes through this, including error text from the driver.
const password = (() => {
  try {
    return decodeURIComponent(new URL(connectionString).password || '')
  } catch {
    return ''
  }
})()

const redact = text => {
  const out = String(text)

  return password ? out.split(password).join('«redacted»').split(encodeURIComponent(password)).join('«redacted»') : out
}

// ── The statement ──────────────────────────────────────────────────────────────

const GRANTS_SQL = `
  SELECT current_user                                        AS connected_as,
         current_database()                                  AS database,
         rolsuper                                            AS is_superuser,
         rolbypassrls                                        AS bypasses_row_security,
         (SELECT string_agg(DISTINCT privilege_type, ', ' ORDER BY privilege_type)
            FROM information_schema.role_table_grants
           WHERE grantee IN (current_user, 'PUBLIC')
             AND table_schema = 'public')                    AS table_privileges
    FROM pg_roles
   WHERE rolname = current_user`

const arg = process.argv.slice(2).join(' ').trim()

if (!arg) {
  console.error('usage: node .claude/harness/db-ro.mjs --grants | "SELECT ..."')
  console.error('')
  console.error('Table and column names are Prisma\'s: quoted and PascalCase/camelCase.')
  console.error('  SELECT COUNT(*) FROM "Loan" WHERE "archivedAt" IS NULL')
  process.exit(1)
}

const sql = arg === '--grants' ? GRANTS_SQL : arg

if (arg !== '--grants') {
  if (!/^\s*(SELECT|WITH|SHOW|EXPLAIN|TABLE)\b/i.test(sql)) {
    console.error('REFUSED: only SELECT / WITH / SHOW / EXPLAIN / TABLE are permitted here.')
    process.exit(1)
  }

  // A trailing `; DELETE ...` would otherwise ride along on a statement that starts with SELECT.
  // Crude — a semicolon inside a string literal trips it — but the cost is retyping the query
  // without it, and the alternative is parsing SQL.
  if (sql.replace(/;\s*$/, '').includes(';')) {
    console.error('REFUSED: multiple statements. Run one at a time.')
    process.exit(1)
  }
}

// ── Driver ─────────────────────────────────────────────────────────────────────
//
// `pg` is already a dependency here — the Prisma adapter uses it — so unlike the system this
// was adapted from, nothing has to be borrowed from a sibling repo.
let pg

try {
  pg = require('pg')
} catch {
  console.error('Could not load `pg`. Run `npm install`.')
  process.exit(1)
}

// RETURN DATES AS THE RAW COLUMN TEXT, never as JS Date objects.
//
// `startOn`, `dueOn`, `paidOn` and `occurredOn` are DATE columns; `createdAt` and friends are
// timestamps. Left alone, pg converts each to a JS Date in the NODE PROCESS's local zone, and
// JSON.stringify then prints it with a trailing 'Z' — so a row holding 2026-09-21 comes back as
// "2026-09-20T16:00:00.000Z" on a UTC+8 host. That reads as an authoritative instant and is off
// by the reader's offset, which is exactly the kind of false precision this whole script exists
// to avoid. A due date that appears to be a day early would look like a real defect.
//
// Only what is PRINTED was ever affected: `WHERE "dueOn" < CURRENT_DATE` is evaluated by Postgres
// on the real values and is always right, which is what makes the problem hard to spot.
const AS_TEXT = [1082, 1083, 1114, 1184, 1186] // date, time, timestamp, timestamptz, interval

for (const oid of AS_TEXT) pg.types.setTypeParser(oid, value => value)

// int8 (20) already arrives as a string, deliberately, because it does not fit a JS number.
// COUNT(*) therefore prints as "12" with quotes. That is the driver being honest; leave it.

const client = new pg.Client({
  connectionString,

  // Supabase free-tier projects sleep after about a week idle and take a few seconds to wake.
  // A short timeout here reports "unreachable" for a database that is merely waking up.
  connectionTimeoutMillis: 20_000,
  statement_timeout: 30_000,
  application_name: 'db-ro'
})

try {
  await client.connect()

  // Postgres' own read-only enforcement, under the string check above.
  await client.query('BEGIN READ ONLY')

  try {
    const result = await client.query(sql)

    console.log(JSON.stringify(result.rows, null, 2))
    console.log(`\n-- ${result.rowCount ?? result.rows.length} row(s), read-only, via ${source}`)
  } finally {
    await client.query('ROLLBACK')
  }
} catch (error) {
  const message = redact(error?.message ?? 'query failed')

  console.error(message)

  if (/ETIMEDOUT|ENOTFOUND|ECONNREFUSED|timeout/i.test(message)) {
    console.error(
      '\nSupabase free-tier projects sleep after roughly a week idle. If this is the first query in a while, ' +
        'wake the project in the Supabase dashboard and try again before concluding the database is unreachable.'
    )
  }

  if (/read-only transaction/i.test(message)) {
    console.error('\nThat statement writes. It was blocked by the read-only transaction, which is this script working.')
  }

  process.exitCode = 1
} finally {
  await client.end().catch(() => {})
}
