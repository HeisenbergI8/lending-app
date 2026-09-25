'use server'

import { randomUUID } from 'node:crypto'

import { revalidatePath } from 'next/cache'

import { type Centavos, centavos } from '../../lib/money/centavos.ts'
import { DAYS_PER_WEEK } from '../../lib/money/weeks.ts'
import { nextUnpaidWeek, weeklySchedule } from '../../lib/money/weekly.ts'
import { checkProofFiles } from '../../lib/proof.ts'
import { requireUser } from '../auth/guard.ts'
import { db } from '../db.ts'
import { type FormState, NO_ERROR, date, failed, text } from '../forms.ts'
import { StorageUnavailable } from '../storage/proof-bucket.ts'
import { SETTLING, paidWeekNumbers } from './settled.ts'
import { type Upload, discardUploads, filesFrom, proofRows, uploadAll } from './uploads.ts'

/**
 * Recording that a loan was repaid, and keeping the proof.
 *
 * FULL PAYMENT ONLY. The borrower hands over the whole total in one go — there
 * are no partial payments and no installments, so the amount is never typed. It
 * is read from the loan, which means it cannot be mistyped and cannot drift from
 * what was agreed the day the loan was created.
 *
 * ON A WEEKLY LOAN THIS IS FEBRUARY: the capital plus the FINAL week's interest,
 * in one payment. The weeks before it were collected one at a time by
 * markWeekPaid in week-actions.ts, and the final week is never collected on its
 * own. FEATURES.md section 5.
 *
 * PROOF IS OPTIONAL BUT FLAGGED. Marking a loan paid with nothing attached is
 * allowed and shows a warning until a file arrives. Requiring the file would
 * mean a real repayment going unrecorded because a screenshot was still on
 * someone else's phone.
 */

function refresh(): void {
  revalidatePath('/', 'layout')
}

type FundingRow = { lenderId: string; earningsCentavos: number; adminCutCentavos: number }

/**
 * What the last week of a weekly loan charges.
 *
 * The remainder of the whole split lands on this week, which is why it is read
 * off the schedule rather than divided out here. It is also why it is safe for
 * it to be uneven: it never travels on its own, only bundled with the capital.
 */
function finalWeekInterest(fundings: FundingRow[], weeks: number): Centavos {
  const schedule = weeklySchedule(
    fundings.map((funding) => ({
      lenderId: funding.lenderId,
      earnings: centavos(funding.earningsCentavos),
      adminCut: centavos(funding.adminCutCentavos),
    })),
    weeks,
  )
  return schedule[weeks - 1].interest
}

/**
 * Mark a loan paid, with the proof attached in the same step.
 *
 * Find-then-write rather than upsert. Payment.loanId is no longer unique, so
 * there is no single-column key to upsert on, and the composite
 * (loanId, weekNumber) key will not take a null week. The guarantee the old
 * unique index gave is still enforced — by the partial unique index the
 * migration wrote — so this can still only ever touch one row.
 *
 * A loan marked paid, undone and paid again reuses the row it already has,
 * along with its proof files, exactly as before.
 */
export async function markPaid(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser()

  const loanId = text(form, 'loanId')
  const paidOn = date(form, 'paidOn')
  if (!paidOn.ok) return failed(`Date paid: ${paidOn.error.toLowerCase()}`)

  const files = filesFrom(form, 'proof')
  const checked = checkProofFiles(files.map((file) => ({ name: file.name, type: file.type, size: file.size })))
  if (!checked.ok) return failed(checked.error)

  const loan = await db.loan.findFirst({
    where: { id: loanId, userId: user.id },
    select: {
      id: true,
      status: true,
      totalCentavos: true,
      capitalCentavos: true,
      startOn: true,
      dueOn: true,
      termDays: true,
      interestCollection: true,
      // Every payment, not just the settling one: the guard below has to know
      // which weeks are still owed before it lets the loan settle.
      payments: { select: { id: true, weekNumber: true, deletedAt: true } },
      fundings: { select: { lenderId: true, earningsCentavos: true, adminCutCentavos: true } },
    },
  })
  if (!loan) return failed('That loan no longer exists.')
  if (loan.status === 'PAID') return failed('That loan is already marked paid.')

  const weeks = loan.termDays / DAYS_PER_WEEK
  let settlingAmount = centavos(loan.totalCentavos)

  if (loan.interestCollection === 'WEEKLY') {
    // SETTLING A WEEKLY LOAN WITH WEEKS STILL OWED WOULD LOSE THEM. February is
    // also the final week, so a loan whose weeks 12 and 13 were never collected
    // would move to PAID carrying two weeks nobody recorded — money the Admin
    // is owed and the app would stop asking for.
    const next = nextUnpaidWeek(loan.startOn, weeks, paidWeekNumbers(loan.payments))
    if (next && next.week < weeks) {
      return failed(
        `Week ${next.week} has not been collected yet. Record every week before marking the loan paid.`,
      )
    }
    // The capital plus the FINAL week's interest, in one payment. The weeks
    // before it were already handed over. FEATURES.md section 5.
    settlingAmount = centavos(loan.capitalCentavos + finalWeekInterest(loan.fundings, weeks))
  }

  const existing = loan.payments.find((row) => row.weekNumber === null)
  const paymentId = existing?.id ?? randomUUID()

  let uploads: Upload[] = []
  try {
    uploads = await uploadAll(user.id, paymentId, files)
  } catch (error) {
    if (error instanceof StorageUnavailable) return failed(uploadFailure(error))
    throw error
  }

  try {
    await db.$transaction(async (tx) => {
      if (existing) {
        await tx.payment.update({
          where: { id: existing.id },
          data: { paidOn: paidOn.value, amountCentavos: settlingAmount, deletedAt: null },
        })
      } else {
        await tx.payment.create({
          data: {
            id: paymentId,
            userId: user.id,
            loanId,
            weekNumber: null,
            paidOn: paidOn.value,
            // Never typed. The total was fixed the day the loan was created.
            amountCentavos: settlingAmount,
          },
        })
      }

      if (uploads.length > 0) {
        await tx.proofFile.createMany({ data: proofRows(user.id, paymentId, uploads) })
      }

      // nextDueOn goes back to the loan's own due date once it is settled.
      // Nothing is owed, so nothing should read as owed on an earlier day.
      await tx.loan.update({
        where: { id: loanId },
        data: { status: 'PAID', nextDueOn: loan.dueOn },
      })
    })
  } catch (error) {
    await discardUploads(uploads)
    throw error
  }

  refresh()
  return NO_ERROR
}

/**
 * Attach proof to a payment already recorded — the usual case for "it's on my phone".
 *
 * `paymentId` names which payment on a weekly loan, because there are up to
 * twenty of them. Without it this attaches to the settling payment, which is
 * what every caller meant back when a loan had only one.
 */
export async function addProof(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser()

  const loanId = text(form, 'loanId')
  const paymentId = text(form, 'paymentId')
  const files = filesFrom(form, 'proof')
  if (files.length === 0) return failed('Choose a file to attach.')

  const checked = checkProofFiles(files.map((file) => ({ name: file.name, type: file.type, size: file.size })))
  if (!checked.ok) return failed(checked.error)

  const payment = await db.payment.findFirst({
    where: paymentId
      ? { id: paymentId, userId: user.id, deletedAt: null }
      : { loanId, userId: user.id, deletedAt: null, ...SETTLING },
    select: { id: true },
  })
  if (!payment) return failed('That payment no longer exists.')

  let uploads: Upload[] = []
  try {
    uploads = await uploadAll(user.id, payment.id, files)
  } catch (error) {
    if (error instanceof StorageUnavailable) return failed(uploadFailure(error))
    throw error
  }

  try {
    await db.proofFile.createMany({ data: proofRows(user.id, payment.id, uploads) })
  } catch (error) {
    await discardUploads(uploads)
    throw error
  }

  refresh()
  return NO_ERROR
}

/**
 * Remove one file from a payment.
 *
 * The file itself stays in the bucket for the thirty days the row spends in
 * Recently Deleted. A restored row pointing at a file that was really gone
 * would be a record that lies about what it has, which is worse than the
 * storage it costs. The purge takes the row and the file together, at the end.
 */
export async function deleteProof(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser()

  const { count } = await db.proofFile.updateMany({
    where: { id: text(form, 'proofFileId'), userId: user.id },
    data: { deletedAt: new Date() },
  })
  if (count === 0) return failed('That file no longer exists.')

  refresh()
  return NO_ERROR
}

/**
 * Undo a payment recorded by mistake.
 *
 * The loan goes back to running and the payment row is soft-deleted, not
 * destroyed, so marking it paid again reuses the same row and the same proof
 * files. The files are left attached rather than deleted alongside: if the payment was
 * recorded in error the screenshots usually still belong to it, and the admin
 * can remove them one at a time if they do not.
 *
 * THE SETTLING ROW ONLY. Undoing February on a weekly loan must not quietly
 * archive twenty collected weeks with it — that money really was received, and
 * a week is undone one at a time by its own button.
 */
export async function undoPayment(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser()
  const loanId = text(form, 'loanId')

  const loan = await db.loan.findFirst({
    where: { id: loanId, userId: user.id },
    select: {
      id: true,
      startOn: true,
      dueOn: true,
      termDays: true,
      interestCollection: true,
      payments: { select: { weekNumber: true, deletedAt: true } },
    },
  })
  if (!loan) return failed('That loan no longer exists.')

  // Back to whatever is owed next now that the settling payment is gone. On a
  // weekly loan that is the final week; on any other it is the loan's due date.
  const weeks = loan.termDays / DAYS_PER_WEEK
  const nextDueOn =
    loan.interestCollection === 'WEEKLY'
      ? (nextUnpaidWeek(loan.startOn, weeks, paidWeekNumbers(loan.payments))?.dueOn ?? loan.dueOn)
      : loan.dueOn

  await db.$transaction(async (tx) => {
    await tx.payment.updateMany({
      where: { loanId, userId: user.id, ...SETTLING },
      data: { deletedAt: new Date() },
    })
    await tx.loan.update({ where: { id: loanId }, data: { status: 'ACTIVE', nextDueOn } })
  })

  refresh()
  return NO_ERROR
}

/**
 * Storage problems get said out loud rather than becoming a blank error page.
 *
 * "Nothing was recorded" is the important half: the files go up before any row
 * is written, so a failure here really does leave the loan exactly as it was.
 */
function uploadFailure(error: StorageUnavailable): string {
  return `Nothing was recorded. ${error.message}`
}
