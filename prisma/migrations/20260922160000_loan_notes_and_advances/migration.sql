-- Two things the Admin can now do to a loan: write a note on it, and draw money
-- against it before the borrower repays.
--
-- Nothing already recorded changes value. Both additions are new rows or a
-- nullable column, so every existing transaction keeps meaning exactly what it
-- meant: an ordinary deposit or withdrawal, with no loan behind it.

-- An advance is an ORDINARY WITHDRAWAL that happens to name the loan it was
-- drawn against. Floating funds already subtracts every withdrawal, so the pot
-- drops the moment one is recorded, with no new arithmetic anywhere. The column
-- exists so the cap on the next advance can be worked out by adding up the
-- advances already taken on that loan rather than by reading a sentence.
ALTER TABLE "LenderTransaction"
  ADD COLUMN "loanId" TEXT;

ALTER TABLE "LenderTransaction"
  ADD CONSTRAINT "LenderTransaction_loanId_fkey"
  FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "LenderTransaction_loanId_idx" ON "LenderTransaction"("loanId");

-- A note has no archivedAt, and that is deliberate — see the schema comment.
-- It holds no money, so there is nothing for Recently Deleted to protect.
CREATE TABLE "LoanNote" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "loanId"    TEXT NOT NULL,
  "body"      TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LoanNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LoanNote_loanId_createdAt_idx" ON "LoanNote"("loanId", "createdAt");
CREATE INDEX "LoanNote_userId_idx" ON "LoanNote"("userId");

ALTER TABLE "LoanNote"
  ADD CONSTRAINT "LoanNote_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LoanNote"
  ADD CONSTRAINT "LoanNote_loanId_fkey"
  FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
