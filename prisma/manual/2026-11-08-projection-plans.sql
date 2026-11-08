-- PASTE ALL OF THIS INTO SUPABASE → SQL Editor → New query → Run.
--
-- Adds saved plans for the Projections page (2026-11-08).
-- RUN IT BEFORE the new version of the app goes live: the Projections page reads these
-- tables. The old app ignores them, so running it early is safe.
-- It only ADDS two empty tables: no existing figure, row or column changes.
-- Run it ONCE. If it says the table already exists, it was already applied.

BEGIN;

-- CreateTable
CREATE TABLE "ProjectionPlan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "newLoansPerMonth" INTEGER NOT NULL,
    "loanAmountCentavos" INTEGER NOT NULL,
    "termWeeks" INTEGER NOT NULL,
    "borrowerRateBps" INTEGER NOT NULL,
    "adminCutBps" INTEGER NOT NULL,
    "interestCollection" "InterestCollection" NOT NULL DEFAULT 'AT_END',
    "relend" BOOLEAN NOT NULL DEFAULT true,
    "horizonMonths" INTEGER NOT NULL DEFAULT 24,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectionMove" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "lenderId" TEXT NOT NULL,
    "type" "LenderTransactionType" NOT NULL,
    "amountCentavos" INTEGER NOT NULL,
    "fromMonth" DATE NOT NULL,
    "everyMonth" BOOLEAN NOT NULL DEFAULT false,
    "untilMonth" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectionMove_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectionPlan_userId_createdAt_idx" ON "ProjectionPlan"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectionPlan_userId_name_key" ON "ProjectionPlan"("userId", "name");

-- CreateIndex
CREATE INDEX "ProjectionMove_planId_idx" ON "ProjectionMove"("planId");

-- CreateIndex
CREATE INDEX "ProjectionMove_lenderId_idx" ON "ProjectionMove"("lenderId");

-- CreateIndex
CREATE INDEX "ProjectionMove_userId_idx" ON "ProjectionMove"("userId");

-- AddForeignKey
ALTER TABLE "ProjectionPlan" ADD CONSTRAINT "ProjectionPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectionMove" ADD CONSTRAINT "ProjectionMove_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectionMove" ADD CONSTRAINT "ProjectionMove_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ProjectionPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectionMove" ADD CONSTRAINT "ProjectionMove_lenderId_fkey" FOREIGN KEY ("lenderId") REFERENCES "Lender"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "_prisma_migrations"
  ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
VALUES
  (gen_random_uuid()::text, '1ee5229713686a7057e071ab8bcebb044b9669f253d44146f3431778065e917a', now(),
   '20261108120000_projection_plans', NULL, NULL, now(), 1);

COMMIT;
