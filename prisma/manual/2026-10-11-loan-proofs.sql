-- PASTE ALL OF THIS INTO SUPABASE → SQL Editor → New query → Run.
--
-- Adds the LoanProof table that new loans need for their screenshot (2026-10-11).
-- It only ADDS a table: no existing loan, payment or figure is changed.
-- It is all-or-nothing (BEGIN … COMMIT), so if anything fails, nothing is
-- applied. The last statement tells Prisma this update is done, so a later
-- "npm run db:migrate" will not try to apply it a second time.
--
-- Run it ONCE. If it says the table already exists, it was already applied.

BEGIN;

CREATE TABLE "LoanProof" (
  "id"          TEXT NOT NULL,
  "userId"      TEXT NOT NULL,
  "loanId"      TEXT NOT NULL,
  "storagePath" TEXT NOT NULL,
  "mimeType"    TEXT NOT NULL,
  "sizeBytes"   INTEGER NOT NULL,
  "archivedAt"  TIMESTAMP(3),
  "uploadedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LoanProof_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LoanProof_loanId_idx" ON "LoanProof"("loanId");
CREATE INDEX "LoanProof_userId_idx" ON "LoanProof"("userId");

ALTER TABLE "LoanProof"
  ADD CONSTRAINT "LoanProof_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LoanProof"
  ADD CONSTRAINT "LoanProof_loanId_fkey"
  FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "_prisma_migrations"
  ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
VALUES
  (gen_random_uuid()::text, '98fd25358fcb609a29d783cb1c51964663b6fea23784acf5b9506df78257b1af', now(),
   '20261011120000_loan_proofs', NULL, NULL, now(), 1);

COMMIT;
