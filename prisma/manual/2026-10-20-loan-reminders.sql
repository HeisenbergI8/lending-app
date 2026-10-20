-- PASTE ALL OF THIS INTO SUPABASE → SQL Editor → New query → Run.
--
-- Adds the "Remind me every N weeks" setting to loans and pending loans (2026-10-20).
-- RUN IT BEFORE the new version of the app goes live: the new app reads these
-- columns on every loan screen. The old app ignores them, so running it early is safe.
-- It only ADDS two empty columns: no figure changes.
-- Run it ONCE. If it says the column already exists, it was already applied.

BEGIN;

ALTER TABLE "Loan" ADD COLUMN "remindEveryWeeks" INTEGER;
ALTER TABLE "PendingLoan" ADD COLUMN "remindEveryWeeks" INTEGER;

INSERT INTO "_prisma_migrations"
  ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
VALUES
  (gen_random_uuid()::text, 'df96f495cc46d61bd86d6eab970969de48a197117a789d86b395312d6745933a', now(),
   '20261020120000_loan_reminders', NULL, NULL, now(), 1);

COMMIT;
