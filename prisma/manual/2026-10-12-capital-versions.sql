-- PASTE ALL OF THIS INTO SUPABASE → SQL Editor → New query → Run.
--
-- Starting capital becomes a typed figure with a history of versions (2026-10-12).
-- RUN IT RIGHT BEFORE the new version of the app goes live. Between running it
-- and the new version going live, the old app's lender pages will show an error.
--
-- What it does: any top-ups and reductions are folded into the typed figure, so
-- nobody's starting capital changes, and those rows stay as ordinary money in
-- and out, so Floating does not change either. Each lender's current figure is
-- saved as their first version.
-- Run it ONCE. If it says the table already exists, it was already applied.

BEGIN;

-- CreateTable
CREATE TABLE "StartingCapitalVersion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lenderId" TEXT NOT NULL,
    "amountCentavos" INTEGER NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StartingCapitalVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StartingCapitalVersion_lenderId_createdAt_idx" ON "StartingCapitalVersion"("lenderId", "createdAt");

-- AddForeignKey
ALTER TABLE "StartingCapitalVersion" ADD CONSTRAINT "StartingCapitalVersion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StartingCapitalVersion" ADD CONSTRAINT "StartingCapitalVersion_lenderId_fkey" FOREIGN KEY ("lenderId") REFERENCES "Lender"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Fold every live top-up and reduction into the typed figure.
UPDATE "Lender" AS l
SET "startingCapitalCentavos" = l."startingCapitalCentavos" + moves.total
FROM (
  SELECT "lenderId",
         SUM(CASE WHEN "type" = 'DEPOSIT' THEN "amountCentavos" ELSE -"amountCentavos" END) AS total
  FROM "LenderTransaction"
  WHERE "isCapital" AND "archivedAt" IS NULL
  GROUP BY "lenderId"
) AS moves
WHERE l."id" = moves."lenderId";

-- The figure each lender carries today becomes their first version.
INSERT INTO "StartingCapitalVersion" ("id", "userId", "lenderId", "amountCentavos", "note")
SELECT gen_random_uuid()::text, "userId", "id", "startingCapitalCentavos", 'Before the version history started'
FROM "Lender"
WHERE "startingCapitalCentavos" <> 0;

-- AlterTable
ALTER TABLE "LenderTransaction" DROP COLUMN "isCapital";

INSERT INTO "_prisma_migrations"
  ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
VALUES
  (gen_random_uuid()::text, 'f39af5555bb4a9537670c367404df21f56a90a6c09a95a6ffee1a892cde38338', now(),
   '20261012180000_capital_versions', NULL, NULL, now(), 1);

COMMIT;
