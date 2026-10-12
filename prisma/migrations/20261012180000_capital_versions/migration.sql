-- Starting capital becomes a typed figure with a history of versions.
--
-- Top-ups and reductions (LenderTransaction.isCapital) are retired. Their sum
-- is folded into the typed figure first, so no lender's starting capital
-- changes. The rows themselves stay as ordinary money in and out, so Floating
-- does not change either.

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
