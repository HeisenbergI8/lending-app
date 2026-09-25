import { db } from '../db.ts'
import { removeProof, storageConfigured } from '../storage/proof-bucket.ts'
import { purgeCutoff } from './window.ts'

/**
 * The one thing in this app that really destroys data.
 *
 * Everything else "deletes" by setting `deletedAt` and hiding the row. This runs
 * once a day, takes everything that has sat in Recently Deleted for longer than
 * the thirty-day window, and removes it from Postgres and from the storage
 * bucket for good. There is no undo behind this point, which is why it is a
 * single file that says out loud what it is about to do.
 *
 * TWO RULES SHAPE EVERYTHING BELOW.
 *
 * 1. FILES BEFORE ROWS. A proof file lives half in Postgres and half in the
 *    bucket. Deleting the row first would strand the file with nothing left
 *    pointing at it — a private screenshot of somebody's payment, paid for
 *    forever, invisible to the app that is supposed to be looking after it. So
 *    the bucket goes first, and if the bucket will not answer, the row STAYS and
 *    tomorrow's run tries again. A day late is free; an orphaned file is not.
 *
 * 2. NOTHING LIVE IS TAKEN DOWN WITH IT. `Loan.borrower` and
 *    `LoanFunding.lender` are onDelete: Restrict in the schema, so Postgres will
 *    refuse to destroy a person some loan still references — and that refusal is
 *    correct. A borrower deleted in January whose loan is still running is a
 *    borrower the books still need. Rather than cascade over it or crash on it,
 *    they are counted as HELD, passed over, and shown on the screen as kept.
 *    They become purgeable on their own once the last loan referencing them goes.
 *
 * Deleting a Loan, by contrast, is meant to cascade: the schema takes its
 * funding split, its payment and that payment's proof rows with it, because
 * those describe the loan and mean nothing without it.
 */

/** What one run did. Returned to the cron so a failure is visible in the logs. */
export type PurgeReport = {
  proofFiles: number
  payments: number
  transactions: number
  loans: number
  borrowers: number
  lenders: number
  /** People past thirty days that live records still point at. Left alone. */
  heldBorrowers: number
  heldLenders: number
  /** Bucket files destroyed, and ones the bucket refused — the second retries tomorrow. */
  filesRemoved: number
  filesKept: number
}

type StoredFile = { id: string; storagePath: string }

const EMPTY: PurgeReport = {
  proofFiles: 0,
  payments: 0,
  transactions: 0,
  loans: 0,
  borrowers: 0,
  lenders: 0,
  heldBorrowers: 0,
  heldLenders: 0,
  filesRemoved: 0,
  filesKept: 0,
}

/**
 * Take everything out of Recently Deleted that is past its thirty days.
 *
 * Scoped to one user when given one — the demo account and the real account
 * never share a run — and to every user otherwise, which is what the cron does.
 */
export async function purgeExpired(options: { userId?: string; now?: Date } = {}): Promise<PurgeReport> {
  const cutoff = purgeCutoff(options.now ?? new Date())
  const owner = options.userId === undefined ? {} : { userId: options.userId }
  const expired = { ...owner, deletedAt: { lt: cutoff } }

  const report = { ...EMPTY }

  // A tracked file cannot be destroyed while the bucket is unreachable, and a
  // run that cannot do that half of the job should not do the other half either.
  const bucketReady = storageConfigured()

  // 1. Proof files removed on their own, still attached to a live payment.
  const looseFiles = await db.proofFile.findMany({
    where: expired,
    select: { id: true, storagePath: true },
  })
  const clearedLoose = await clearFromBucket(looseFiles, bucketReady, report)
  if (clearedLoose.length > 0) {
    const { count } = await db.proofFile.deleteMany({ where: { id: { in: clearedLoose } } })
    report.proofFiles = count
  }

  // 2. Undone payments. Their proof rows go with them by cascade, so their files
  //    have to leave the bucket first — all of them, not just deleted ones.
  const payments = await db.payment.findMany({
    where: expired,
    select: { id: true, proofFiles: { select: { id: true, storagePath: true } } },
  })
  const clearablePayments = await clearOwners(payments, bucketReady, report)
  if (clearablePayments.length > 0) {
    const { count } = await db.payment.deleteMany({ where: { id: { in: clearablePayments } } })
    report.payments = count
  }

  // 3. Money in and out. Nothing hangs off these.
  const { count: transactions } = await db.lenderTransaction.deleteMany({ where: expired })
  report.transactions = transactions

  // 4. Loans, which take their funding split and EVERY payment with them.
  //
  //    ALL of them, not the settling one. A loan collecting its interest weekly
  //    carries up to twenty payment rows, each with its own screenshots, and
  //    they all cascade out of Postgres when the loan row goes. Selecting one
  //    payment here would type-check, delete nineteen rows, and leave nineteen
  //    sets of private screenshots in the bucket with nothing left pointing at
  //    them — which is the exact failure rule 1 of this file exists to prevent.
  const loans = await db.loan.findMany({
    where: expired,
    select: { id: true, payments: { select: { proofFiles: { select: { id: true, storagePath: true } } } } },
  })
  const clearableLoans = await clearOwners(
    loans.map((loan) => ({
      id: loan.id,
      proofFiles: loan.payments.flatMap((payment) => payment.proofFiles),
    })),
    bucketReady,
    report,
  )
  if (clearableLoans.length > 0) {
    const { count } = await db.loan.deleteMany({ where: { id: { in: clearableLoans } } })
    report.loans = count
  }

  // 5. People, last, and only the ones nothing points at any more. The counts
  //    are taken AFTER the loans above are gone, so a borrower whose last loan
  //    just went in this same run leaves in it too.
  const borrowers = await db.borrower.findMany({
    where: expired,
    select: { id: true, _count: { select: { loans: true } } },
  })
  const freeBorrowers = borrowers.filter((row) => row._count.loans === 0).map((row) => row.id)
  report.heldBorrowers = borrowers.length - freeBorrowers.length
  if (freeBorrowers.length > 0) {
    const { count } = await db.borrower.deleteMany({ where: { id: { in: freeBorrowers } } })
    report.borrowers = count
  }

  // A lender's transactions cascade, so only their funding rows hold them back.
  const lenders = await db.lender.findMany({
    where: expired,
    select: { id: true, _count: { select: { fundings: true } } },
  })
  const freeLenders = lenders.filter((row) => row._count.fundings === 0).map((row) => row.id)
  report.heldLenders = lenders.length - freeLenders.length
  if (freeLenders.length > 0) {
    const { count } = await db.lender.deleteMany({ where: { id: { in: freeLenders } } })
    report.lenders = count
  }

  return report
}

/**
 * Destroy these files in the bucket, and say which ones went.
 *
 * A file the bucket refuses is not an error worth abandoning the run for — it is
 * a reason to leave its row alone and come back tomorrow. So failures are
 * counted, not thrown.
 */
async function clearFromBucket(
  files: StoredFile[],
  bucketReady: boolean,
  report: PurgeReport,
): Promise<string[]> {
  if (files.length === 0) return []
  if (!bucketReady) {
    report.filesKept += files.length
    return []
  }

  const cleared: string[] = []
  for (const file of files) {
    try {
      await removeProof(file.storagePath)
      report.filesRemoved += 1
      cleared.push(file.id)
    } catch {
      report.filesKept += 1
    }
  }
  return cleared
}

/**
 * The same, for a row whose destruction would cascade onto proof files.
 *
 * All or nothing per owner: a loan is only destroyed once every file beneath it
 * is out of the bucket, because a partial cascade is exactly how an orphan is
 * made. One stubborn file keeps its whole loan for another day.
 */
async function clearOwners(
  owners: { id: string; proofFiles: StoredFile[] }[],
  bucketReady: boolean,
  report: PurgeReport,
): Promise<string[]> {
  const clearable: string[] = []
  for (const owner of owners) {
    const cleared = await clearFromBucket(owner.proofFiles, bucketReady, report)
    if (cleared.length === owner.proofFiles.length) clearable.push(owner.id)
  }
  return clearable
}
