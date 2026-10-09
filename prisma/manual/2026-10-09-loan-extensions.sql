-- PASTE ALL OF THIS INTO SUPABASE → SQL Editor → New query → Run.
--
-- Adds the LoanExtension table that the Extend button needs (2026-10-09).
-- It only ADDS a table: no existing loan, payment or figure is changed.
-- It is all-or-nothing (BEGIN … COMMIT), so if anything fails, nothing is
-- applied. The last statement tells Prisma this update is done, so a later
-- "npm run db:migrate" will not try to apply it a second time.
--
-- Run it ONCE. If it says the table already exists, it was already applied.

BEGIN;

CREATE TABLE "LoanExtension" (
  "id"                    TEXT NOT NULL,
  "userId"                TEXT NOT NULL,
  "loanId"                TEXT NOT NULL,
  "extendedOn"            DATE NOT NULL,
  "fromDueOn"             DATE NOT NULL,
  "toDueOn"               DATE NOT NULL,
  "addedDays"             INTEGER NOT NULL,
  "addedInterestCentavos" INTEGER NOT NULL,
  "addedLenderInterestCentavos" INTEGER NOT NULL DEFAULT 0,
  "interestPaidCentavos"  INTEGER NOT NULL DEFAULT 0,
  "continuedLoanId"       TEXT,
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LoanExtension_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LoanExtension_loanId_idx" ON "LoanExtension"("loanId");
CREATE INDEX "LoanExtension_continuedLoanId_idx" ON "LoanExtension"("continuedLoanId");
CREATE INDEX "LoanExtension_userId_idx" ON "LoanExtension"("userId");

ALTER TABLE "LoanExtension"
  ADD CONSTRAINT "LoanExtension_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LoanExtension"
  ADD CONSTRAINT "LoanExtension_loanId_fkey"
  FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LoanExtension"
  ADD CONSTRAINT "LoanExtension_continuedLoanId_fkey"
  FOREIGN KEY ("continuedLoanId") REFERENCES "Loan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "_prisma_migrations"
  ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
VALUES
  (gen_random_uuid()::text, '93a4de2b711b77b19b12ef71dcf9ebbb2615bf37580917e5e324bf22b4162ab1', now(),
   '20261009120000_loan_extensions', NULL, NULL, now(), 1);

COMMIT;
