-- Weekly-interest loans. FEATURES.md section 5, added 2026-09-24.
--
-- Written by hand rather than generated, for ONE reason: the partial unique
-- index at the bottom. Prisma cannot express `WHERE "weekNumber" IS NULL` on an
-- index, and without it a loan could take two settling payments — the exact
-- guarantee Payment_loanId_key gave before this migration, and the one thing
-- here that must not be weakened.
--
-- NOTHING BELOW REWRITES MONEY. The only UPDATE copies a date column onto a new
-- date column. Every existing Payment row keeps its id, its amount, its date,
-- its proof files and its meaning: weekNumber NULL is "the settling payment",
-- which is what all of them already are.

CREATE TYPE "InterestCollection" AS ENUM ('AT_END', 'WEEKLY');

ALTER TABLE "Loan"
  ADD COLUMN "interestCollection" "InterestCollection" NOT NULL DEFAULT 'AT_END',
  ADD COLUMN "nextDueOn" DATE;

-- Every loan that exists is collected at the end, so the next day money is owed
-- on it IS its due date. Done before the NOT NULL below, so no row is ever
-- briefly wrong.
UPDATE "Loan" SET "nextDueOn" = "dueOn" WHERE "nextDueOn" IS NULL;

ALTER TABLE "Loan" ALTER COLUMN "nextDueOn" SET NOT NULL;

CREATE INDEX "Loan_userId_status_nextDueOn_idx" ON "Loan"("userId", "status", "nextDueOn");

ALTER TABLE "Payment" ADD COLUMN "weekNumber" INTEGER;

-- The old guarantee, in the form that still allows weekly rows beside it.
-- Postgres treats NULLs as distinct in an ordinary unique index, so
-- ("loanId", "weekNumber") alone would let a loan take two settling payments.
-- This is the half that stops it.
DROP INDEX "Payment_loanId_key";

CREATE UNIQUE INDEX "Payment_loanId_settling_key"
  ON "Payment"("loanId")
  WHERE "weekNumber" IS NULL;

-- And this is the half that stops a week being paid twice.
CREATE UNIQUE INDEX "Payment_loanId_weekNumber_key" ON "Payment"("loanId", "weekNumber");

CREATE INDEX "Payment_loanId_idx" ON "Payment"("loanId");
CREATE INDEX "Payment_userId_archivedAt_idx" ON "Payment"("userId", "archivedAt");
