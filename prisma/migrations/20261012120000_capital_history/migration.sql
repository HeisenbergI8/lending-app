-- Starting capital history: a deposit or withdrawal can be marked as a
-- starting capital top-up or reduction.
--
-- ONE NEW COLUMN, false on every existing row, so no figure changes.
ALTER TABLE "LenderTransaction" ADD COLUMN "isCapital" BOOLEAN NOT NULL DEFAULT false;
