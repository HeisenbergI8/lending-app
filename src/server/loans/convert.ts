'use server'

import { revalidatePath } from 'next/cache'

import { centavos } from '../../lib/money/centavos.ts'
import { type Result, ok, err } from '../../lib/money/result.ts'
import { DAYS_PER_WEEK } from '../../lib/money/weeks.ts'
import { MIN_WEEKLY_WEEKS, nextUnpaidWeek, weeklySchedule } from '../../lib/money/weekly.ts'
import { requireUser } from '../auth/guard.ts'
import { db } from '../db.ts'
import { type FormState, NO_ERROR, date, failed, text } from '../forms.ts'

/**
 * Switching a loan already in the app to weekly collection.
 *
 * WHY THIS IS NOT JUST AN EDIT. updateLoan recomputes every figure from the
 * submitted form, which is right when something was entered wrong and wrong
 * here: nothing about this loan was entered wrong. The capital, the rate, the
 * dates, the split and every funding row stay exactly as they are. The only
 * thing that changes is WHEN the interest is collected, and which weeks have
 * already been handed over.
 *
 * So this writes two things and touches no money column: Loan.interestCollection,
 * and one Payment row per week the Admin ticks. The schedule is generated from
 * the dates the loan already has, exactly as it would have been at creation,
 * because the arithmetic in money/weekly.ts reads the stored funding rows and
 * nothing else.
 *
 * REFUSED on a FIXED_AMOUNT loan, on a PAID loan, and on a loan whose term is
 * not whole weeks. The first two for the reasons loanTerms and updateLoan
 * already give; the third because a stored termDays that is not a multiple of 7
 * cannot happen on a WEEKLY_RATE loan, and finding one means something else is
 * wrong and this is not the place to paper over it.
 *
 * EACH TICKED WEEK GETS ITS OWN PAID DATE, typed by the Admin — FEATURES.md
 * section 5. Not defaulted to the week's due date: the point of recording them
 * is the history, and a history of twenty dates nobody chose is not one.
 *
 * PROOF IS NOT COLLECTED HERE. These are weeks that were paid before the app
 * knew about them; the screenshots are wherever they are. Each row flags itself
 * as missing proof, like any other payment, and Add proof on the loan page is
 * how it arrives later.
 *
 * REVERSING A CONVERSION IS NOT BUILT, and that is a decision rather than an
 * omission. Switching back would have to decide what happens to the weeks
 * already recorded, and the honest answer is that they are payments and payments
 * are undone one at a time. The Admin undoes each week, then edits the loan.
 */

type TickedWeek = { week: number; paidOn: Date }

/**
 * The weeks the Admin ticked, each with the date they typed against it.
 *
 * A ticked week with no date is refused rather than defaulted. The date is the
 * only thing this flow records that is not already in the database, so guessing
 * it would make the whole exercise pointless.
 */
function readTickedWeeks(form: FormData, weeks: number): Result<TickedWeek[], string> {
  const ticked: TickedWeek[] = []

  for (let week = 1; week <= weeks; week += 1) {
    if (text(form, `week-${week}`) !== 'on') continue

    const paidOn = date(form, `week-${week}-paidOn`)
    if (!paidOn.ok) return err(`Week ${week}: ${paidOn.error.toLowerCase()}`)
    ticked.push({ week, paidOn: paidOn.value })
  }

  return ok(ticked)
}

export async function convertToWeekly(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser()

  const loanId = text(form, 'loanId')
  const loan = await db.loan.findFirst({
    where: { id: loanId, userId: user.id, deletedAt: null },
    select: {
      id: true,
      status: true,
      startOn: true,
      dueOn: true,
      termDays: true,
      interestBasis: true,
      interestCollection: true,
      payments: { select: { id: true, weekNumber: true, deletedAt: true } },
      fundings: { select: { lenderId: true, earningsCentavos: true, adminCutCentavos: true } },
    },
  })
  if (!loan) return failed('That loan no longer exists.')
  if (loan.interestCollection === 'WEEKLY') {
    return failed('That loan already collects its interest weekly.')
  }
  if (loan.interestBasis !== 'WEEKLY_RATE') {
    return failed('A loan charging a fixed amount of interest cannot be collected weekly.')
  }
  if (loan.status === 'PAID') {
    return failed('That loan has been paid, so there is nothing left to collect weekly.')
  }
  if (loan.payments.some((row) => row.deletedAt === null)) {
    return failed('That loan already has a payment recorded. Undo it first.')
  }

  const weeks = loan.termDays / DAYS_PER_WEEK
  if (!Number.isInteger(weeks) || weeks < MIN_WEEKLY_WEEKS) {
    return failed('A loan collected weekly runs a whole number of weeks, at least two.')
  }

  const ticked = readTickedWeeks(form, weeks)
  if (!ticked.ok) return failed(ticked.error)

  // The FINAL week cannot be ticked: it is handed over with the capital, and a
  // loan whose capital has come back is a loan that is paid, not one being
  // converted.
  if (ticked.value.some((row) => row.week === weeks)) {
    return failed('The final week is collected with the capital, so it cannot be ticked off here.')
  }

  const schedule = weeklySchedule(
    loan.fundings.map((funding) => ({
      lenderId: funding.lenderId,
      earnings: centavos(funding.earningsCentavos),
      adminCut: centavos(funding.adminCutCentavos),
    })),
    weeks,
  )

  // An ARCHIVED row can already occupy a week: a loan converted, undone week by
  // week and converted again reuses the rows it has, for the same reason
  // markWeekPaid does. createMany would throw on the unique constraint.
  const archived = new Map(
    loan.payments
      .filter((row) => row.weekNumber !== null)
      .map((row) => [row.weekNumber as number, row.id]),
  )

  await db.$transaction(async (tx) => {
    for (const row of ticked.value) {
      // The week's own amount from the schedule, NOT a figure the Admin typed.
      // The weeks were collected at the amounts this loan was created with,
      // whatever anybody remembers.
      const amountCentavos = schedule[row.week - 1].interest
      const existing = archived.get(row.week)

      if (existing) {
        await tx.payment.update({
          where: { id: existing },
          data: { paidOn: row.paidOn, amountCentavos, deletedAt: null },
        })
      } else {
        await tx.payment.create({
          data: {
            userId: user.id,
            loanId,
            weekNumber: row.week,
            paidOn: row.paidOn,
            amountCentavos,
          },
        })
      }
    }

    const next = nextUnpaidWeek(loan.startOn, weeks, new Set(ticked.value.map((row) => row.week)))
    await tx.loan.update({
      where: { id: loanId },
      data: {
        interestCollection: 'WEEKLY',
        nextDueOn: next?.dueOn ?? loan.dueOn,
      },
    })
  })

  revalidatePath('/', 'layout')
  return NO_ERROR
}
