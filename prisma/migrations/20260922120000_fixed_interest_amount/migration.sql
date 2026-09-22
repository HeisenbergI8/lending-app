-- A loan may now charge a fixed peso amount of interest instead of a weekly rate.
--
-- Nothing already recorded changes value. Existing loans are all WEEKLY_RATE, and
-- their term converts exactly: a loan stored as 4 weeks becomes 28 days, which is
-- what its two dates already said. The weeks column goes because the term now has
-- one home; weeks are derived back out of termDays for display.

CREATE TYPE "InterestBasis" AS ENUM ('WEEKLY_RATE', 'FIXED_AMOUNT');

ALTER TABLE "Loan"
  ADD COLUMN "interestBasis" "InterestBasis" NOT NULL DEFAULT 'WEEKLY_RATE',
  ADD COLUMN "termDays" INTEGER;

UPDATE "Loan" SET "termDays" = "weeks" * 7;

ALTER TABLE "Loan"
  ALTER COLUMN "termDays" SET NOT NULL,
  DROP COLUMN "weeks",
  -- No rate was used on a fixed-amount loan, so none is recorded. Null rather
  -- than zero, which would render as "0% a week" and read as a chosen rate.
  ALTER COLUMN "borrowerRateBps" DROP NOT NULL;

ALTER TABLE "LoanFunding"
  ALTER COLUMN "lenderRateBps" DROP NOT NULL,
  ALTER COLUMN "adminCutBps" DROP NOT NULL;
