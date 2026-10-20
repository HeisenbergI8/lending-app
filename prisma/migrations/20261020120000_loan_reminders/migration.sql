-- "Remind me every N weeks" on a loan and on a pending request.
-- Two new nullable columns; null (off) on every existing row, so nothing changes.

-- AlterTable
ALTER TABLE "Loan" ADD COLUMN "remindEveryWeeks" INTEGER;

-- AlterTable
ALTER TABLE "PendingLoan" ADD COLUMN "remindEveryWeeks" INTEGER;
