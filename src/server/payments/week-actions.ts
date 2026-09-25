'use server'

import { randomUUID } from 'node:crypto'

import { revalidatePath } from 'next/cache'

import { centavos } from '../../lib/money/centavos.ts'
import { DAYS_PER_WEEK } from '../../lib/money/weeks.ts'
import { nextUnpaidWeek, weeklySchedule } from '../../lib/money/weekly.ts'
import { checkProofFiles } from '../../lib/proof.ts'
import { requireUser } from '../auth/guard.ts'
import { db } from '../db.ts'
import { type FormState, NO_ERROR, date, failed, text } from '../forms.ts'
import { StorageUnavailable } from '../storage/proof-bucket.ts'
import { paidWeekNumbers } from './settled.ts'
import { type Upload, discardUploads, filesFrom, proofRows, uploadAll } from './uploads.ts'

/**
 * Collecting one week of interest on a weekly loan.
 *
 * ONE WEEK AT A TIME, AND NEVER AHEAD. FEATURES.md section 5, answered
 * explicitly: no paying two weeks in one go and no paying ahead. So the week
 * number is not a field the Admin picks — it is read from the loan as the
 * earliest unpaid one, which means it cannot be mistyped and cannot skip a week
 * that is still owed.
 *
 * THE FINAL WEEK IS NOT COLLECTED HERE. It is handed over with the capital in
 * one payment, which is markPaid in actions.ts. Asking for it here is refused
 * rather than silently redirected: the two amounts are wildly different and a
 * button that quietly did the bigger one would be a very bad surprise.
 *
 * PROOF IS OPTIONAL BUT FLAGGED, and the files go into the bucket BEFORE any
 * row is written — the same order, and the same reason, as the full repayment.
 * A failed upload leaves the week uncollected and the Admin simply tries again.
 */

function refresh(): void {
  revalidatePath('/', 'layout')
}

export async function markWeekPaid(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser()

  const loanId = text(form, 'loanId')
  const paidOn = date(form, 'paidOn')
  if (!paidOn.ok) return failed(`Date paid: ${paidOn.error.toLowerCase()}`)

  const files = filesFrom(form, 'proof')
  const checked = checkProofFiles(files.map((file) => ({ name: file.name, type: file.type, size: file.size })))
  if (!checked.ok) return failed(checked.error)

  const loan = await db.loan.findFirst({
    where: { id: loanId, userId: user.id, deletedAt: null },
    select: {
      id: true,
      status: true,
      startOn: true,
      dueOn: true,
      termDays: true,
      interestCollection: true,
      // Archived rows come too. An undone week still occupies its slot in the
      // (loanId, weekNumber) unique index, so recording it again has to reuse
      // that row rather than create a second one.
      payments: { select: { id: true, weekNumber: true, deletedAt: true } },
      fundings: { select: { lenderId: true, earningsCentavos: true, adminCutCentavos: true } },
    },
  })
  if (!loan) return failed('That loan no longer exists.')
  if (loan.interestCollection !== 'WEEKLY') {
    return failed('That loan does not collect its interest weekly.')
  }
  if (loan.status === 'PAID') return failed('That loan is already marked paid.')

  const weeks = loan.termDays / DAYS_PER_WEEK
  const next = nextUnpaidWeek(loan.startOn, weeks, paidWeekNumbers(loan.payments))
  if (!next) return failed('Every week on that loan has been collected.')

  // The last week goes with the capital, in one payment, and that is a
  // different button. Said out loud rather than redirected — see the file note.
  if (next.week === weeks) {
    return failed(
      'The final week is collected with the capital. Use Mark as paid to record the whole thing.',
    )
  }

  // The week's own amount, carved out of the funding rows the loan was created
  // with. Never typed, and never recomputed from a rate.
  const schedule = weeklySchedule(
    loan.fundings.map((funding) => ({
      lenderId: funding.lenderId,
      earnings: centavos(funding.earningsCentavos),
      adminCut: centavos(funding.adminCutCentavos),
    })),
    weeks,
  )
  const instalment = schedule[next.week - 1]

  // FIND-THEN-WRITE, not create. An undone week leaves an archived row holding
  // (loanId, weekNumber), so `create` throws on the unique constraint the first
  // time the Admin corrects a mistake — and passes every test written against a
  // loan nobody has corrected.
  const existing = loan.payments.find((row) => row.weekNumber === next.week)
  const paymentId = existing?.id ?? randomUUID()

  let uploads: Upload[] = []
  try {
    uploads = await uploadAll(user.id, paymentId, files)
  } catch (error) {
    if (error instanceof StorageUnavailable) return failed(`Nothing was recorded. ${error.message}`)
    throw error
  }

  try {
    await db.$transaction(async (tx) => {
      if (existing) {
        await tx.payment.update({
          where: { id: existing.id },
          data: { paidOn: paidOn.value, amountCentavos: instalment.interest, deletedAt: null },
        })
      } else {
        await tx.payment.create({
          data: {
            id: paymentId,
            userId: user.id,
            loanId,
            weekNumber: next.week,
            paidOn: paidOn.value,
            amountCentavos: instalment.interest,
          },
        })
      }

      if (uploads.length > 0) {
        await tx.proofFile.createMany({ data: proofRows(user.id, paymentId, uploads) })
      }

      // The loan STAYS ACTIVE and the capital stays out. Only the date money is
      // next owed moves. FEATURES.md section 5: out on loan holds steady while
      // the interest collected climbs each week it is actually handed over.
      const after = nextUnpaidWeek(
        loan.startOn,
        weeks,
        new Set([...paidWeekNumbers(loan.payments), next.week]),
      )
      await tx.loan.update({
        where: { id: loanId },
        data: { nextDueOn: after?.dueOn ?? loan.dueOn },
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
 * Undo a week recorded by mistake.
 *
 * Soft-deleted rather than destroyed, like every other payment, so the proof
 * files stay attached and the week can be recorded again into the same row.
 *
 * The loan's next due date moves BACK with it. Without that the schedule would
 * show week 7 owed again while the loans list still chased week 8, and the two
 * would disagree on the same screen refresh.
 */
export async function undoWeekPaid(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser()

  const loanId = text(form, 'loanId')
  const week = Number(text(form, 'weekNumber'))
  if (!Number.isInteger(week) || week < 1) return failed('That week does not exist on this loan.')

  const loan = await db.loan.findFirst({
    where: { id: loanId, userId: user.id },
    select: {
      id: true,
      startOn: true,
      dueOn: true,
      termDays: true,
      payments: { select: { id: true, weekNumber: true, deletedAt: true } },
    },
  })
  if (!loan) return failed('That loan no longer exists.')

  const payment = loan.payments.find((row) => row.weekNumber === week && row.deletedAt === null)
  if (!payment) return failed('That week has not been collected.')

  const weeks = loan.termDays / DAYS_PER_WEEK
  const paidAfter = paidWeekNumbers(loan.payments)
  paidAfter.delete(week)
  const next = nextUnpaidWeek(loan.startOn, weeks, paidAfter)

  await db.$transaction(async (tx) => {
    await tx.payment.update({ where: { id: payment.id }, data: { deletedAt: new Date() } })
    await tx.loan.update({
      where: { id: loanId },
      data: { nextDueOn: next?.dueOn ?? loan.dueOn },
    })
  })

  refresh()
  return NO_ERROR
}
