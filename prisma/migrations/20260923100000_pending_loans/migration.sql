-- Loan requests waiting for a lender.
--
-- A new table and nothing else. No existing row changes, no existing column
-- moves, and every other screen queries tables this one does not touch.
--
-- No "archivedAt" column, unlike almost everything else here. A request that is
-- turned down carries no money history to protect, and one that is accepted is
-- deleted in the same transaction that writes the loan it became — see the
-- schema comment. Recently Deleted therefore never shows one.
CREATE TABLE "PendingLoan" (
  "id"              TEXT NOT NULL,
  "userId"          TEXT NOT NULL,
  "firstName"       TEXT NOT NULL,
  "lastName"        TEXT NOT NULL,
  "capitalCentavos" INTEGER NOT NULL,
  "borrowerRateBps" INTEGER NOT NULL,
  "termDays"        INTEGER NOT NULL,
  "startOn"         DATE,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PendingLoan_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PendingLoan_userId_createdAt_idx" ON "PendingLoan"("userId", "createdAt");

ALTER TABLE "PendingLoan"
  ADD CONSTRAINT "PendingLoan_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
