-- Loan proof: the screenshot of the money being SENT to the borrower.
--
-- ONE NEW TABLE, nothing else touched. No existing loan or figure changes.
-- Until this is applied, saving a new loan says it is waiting for this step.
--
-- See the LoanProof model in schema.prisma for what each column means.
CREATE TABLE "LoanProof" (
  "id"          TEXT NOT NULL,
  "userId"      TEXT NOT NULL,
  "loanId"      TEXT NOT NULL,
  "storagePath" TEXT NOT NULL,
  "mimeType"    TEXT NOT NULL,
  "sizeBytes"   INTEGER NOT NULL,
  "archivedAt"  TIMESTAMP(3),
  "uploadedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LoanProof_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LoanProof_loanId_idx" ON "LoanProof"("loanId");
CREATE INDEX "LoanProof_userId_idx" ON "LoanProof"("userId");

ALTER TABLE "LoanProof"
  ADD CONSTRAINT "LoanProof_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LoanProof"
  ADD CONSTRAINT "LoanProof_loanId_fkey"
  FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
