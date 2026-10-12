-- PASTE ALL OF THIS INTO SUPABASE → SQL Editor → New query → Run.
--
-- Adds one column that the starting capital history needs (2026-10-12).
-- RUN IT BEFORE the new version of the app goes live: the new app reads this
-- column on every lender page. The old app ignores it, so running it early is safe.
-- It only ADDS a column, false on every existing row: no figure changes.
-- Run it ONCE. If it says the column already exists, it was already applied.

BEGIN;

ALTER TABLE "LenderTransaction" ADD COLUMN "isCapital" BOOLEAN NOT NULL DEFAULT false;

INSERT INTO "_prisma_migrations"
  ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
VALUES
  (gen_random_uuid()::text, 'b668c8254fa1d74d81e582d43fee9ec72b49c70090ef8111877027c164ba6ee5', now(),
   '20261012120000_capital_history', NULL, NULL, now(), 1);

COMMIT;
