-- Loan extensions: the history of a borrower being given more time.
--
-- ONE NEW TABLE, nothing else touched. No existing row or figure changes, and
-- the app runs with or without it: until this is applied the Extend button says
-- it is waiting for this step, and every screen reads "no extensions".
--
-- See the LoanExtension model in schema.prisma for what each column means.
CREATE TABLE "LoanExtension" (
  "id"                    TEXT NOT NULL,
  "userId"                TEXT NOT NULL,
  "loanId"                TEXT NOT NULL,
  "extendedOn"            DATE NOT NULL,
  "fromDueOn"             DATE NOT NULL,
  "toDueOn"               DATE NOT NULL,
  "addedDays"             INTEGER NOT NULL,
  "addedInterestCentavos" INTEGER NOT NULL,
  "addedLenderInterestCentavos" INTEGER NOT NULL DEFAULT 0,
  "interestPaidCentavos"  INTEGER NOT NULL DEFAULT 0,
  "continuedLoanId"       TEXT,
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LoanExtension_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LoanExtension_loanId_idx" ON "LoanExtension"("loanId");
CREATE INDEX "LoanExtension_continuedLoanId_idx" ON "LoanExtension"("continuedLoanId");
CREATE INDEX "LoanExtension_userId_idx" ON "LoanExtension"("userId");

ALTER TABLE "LoanExtension"
  ADD CONSTRAINT "LoanExtension_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LoanExtension"
  ADD CONSTRAINT "LoanExtension_loanId_fkey"
  FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LoanExtension"
  ADD CONSTRAINT "LoanExtension_continuedLoanId_fkey"
  FOREIGN KEY ("continuedLoanId") REFERENCES "Loan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
