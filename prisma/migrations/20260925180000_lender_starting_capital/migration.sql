-- What each lender put in to start.
--
-- ONE ADDITIVE COLUMN with a default, so every existing row gets 0 and no
-- existing figure on any screen changes. Nothing is backfilled here on purpose:
-- 0 means "the Admin has not said yet", and guessing it from the deposit rows
-- would invent the very number this column exists to replace. The deposits on
-- this account were entered loan by loan after the fact, so their sum is the
-- size of the lending, not the size of the stake.
--
-- It is an INPUT, not a cache. No query writes it, no job maintains it, and
-- floating funds does not read it — see the schema comment and
-- src/lib/money/floating.ts.
ALTER TABLE "Lender"
  ADD COLUMN "startingCapitalCentavos" INTEGER NOT NULL DEFAULT 0;
