'use server'

import { revalidatePath } from 'next/cache'

import { centavos } from '../../lib/money/centavos.ts'
import { DAYS_PER_WEEK, calendarDate, storedCalendarDate } from '../../lib/money/weeks.ts'
import { nextUnpaidWeek } from '../../lib/money/weekly.ts'
import { requireUser } from '../auth/guard.ts'
import { db } from '../db.ts'
import { type FormState, NO_ERROR, amount, failed, text } from '../forms.ts'
import { SETTLING } from '../payments/settled.ts'
import { type ExtendableLoan, type ExtensionPlan, planExtension } from './extension-terms.ts'
import { isMissingTable } from './extensions.ts'
import { loanTerms } from './terms.ts'

/**
 * Extending a loan, and undoing an extension entered by mistake.
 *
 * The arithmetic is planExtension's (extension-terms.ts). This file loads the
 * loan, writes the plan, and records the LoanExtension row beside it — all in
 * one transaction, so a loan is never left extended without its record or the
 * other way round. If the LoanExtension table is not there yet, the insert fails,
 * the transaction rolls back, and the Admin is told what is missing: nothing
 * about the loan changes.
 */

function refresh(): void {
  revalidatePath('/', 'layout')
}

const NOT_READY =
  'Extending needs a one-time update to the database first (the LoanExtension table). Nothing was changed.'

class Refused extends Error {}

const loanSelect = {
  id: true,
  status: true,
  borrowerId: true,
  capitalCentavos: true,
  startOn: true,
  dueOn: true,
  termDays: true,
  interestBasis: true,
  interestCollection: true,
  borrowerRateBps: true,
  interestCentavos: true,
  fundings: {
    select: {
      lenderId: true,
      principalCentavos: true,
      adminCutBps: true,
      earningsCentavos: true,
      lender: { select: { isSelf: true } },
    },
  },
  payments: { select: { id: true, weekNumber: true, deletedAt: true } },
} as const

type LoadedLoan = NonNullable<Awaited<ReturnType<typeof loadLoan>>>

function loadLoan(userId: string, loanId: string) {
  return db.loan.findFirst({ where: { id: loanId, userId, deletedAt: null }, select: loanSelect })
}

function extendable(loan: LoadedLoan): ExtendableLoan {
  return {
    capital: centavos(loan.capitalCentavos),
    startOn: storedCalendarDate(loan.startOn),
    dueOn: storedCalendarDate(loan.dueOn),
    interestBasis: loan.interestBasis,
    interestCollection: loan.interestCollection,
    borrowerRateBps: loan.borrowerRateBps,
    interest: centavos(loan.interestCentavos),
    fundings: loan.fundings.map((f) => ({
      lenderId: f.lenderId,
      isSelf: f.lender.isSelf,
      principal: centavos(f.principalCentavos),
      adminCutBps: f.adminCutBps,
      earnings: centavos(f.earningsCentavos),
    })),
    paidWeeks: new Set(
      loan.payments.flatMap((p) => (p.deletedAt === null && p.weekNumber !== null ? [p.weekNumber] : [])),
    ),
  }
}

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0]

async function writeFundings(tx: Tx, userId: string, loanId: string, terms: Extract<ExtensionPlan, { mode: 'later' }>['terms']) {
  await tx.loanFunding.deleteMany({ where: { loanId, userId } })
  await tx.loanFunding.createMany({
    data: terms.fundings.map((f) => ({
      userId,
      loanId,
      lenderId: f.lenderId,
      principalCentavos: f.principal,
      lenderRateBps: f.lenderRateBps,
      adminCutBps: f.adminCutBps,
      earningsCentavos: f.earnings,
      adminCutCentavos: f.adminCut,
    })),
  })
}

export async function extendLoan(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser()
  const loanId = text(form, 'loanId')

  const raw = text(form, 'weeks')
  if (!/^\d+$/.test(raw)) return failed('Choose how many weeks to extend by.')
  const mode = text(form, 'paidNow') === 'yes' ? 'now' : 'later'

  const loan = await loadLoan(user.id, loanId)
  if (!loan) return failed('That loan no longer exists.')
  if (loan.status === 'PAID') return failed('A loan that has been paid cannot be extended.')

  let fixed: { interest: ReturnType<typeof centavos>; lenderInterest: ReturnType<typeof centavos> } | undefined
  if (loan.interestBasis === 'FIXED_AMOUNT') {
    const extra = amount(form, 'extraInterest')
    if (!extra.ok) return failed(`Extra interest: ${extra.error.toLowerCase()}`)
    const typedShare = text(form, 'extraLenderShare')
    const share = typedShare ? amount(form, 'extraLenderShare') : { ok: true as const, value: centavos(0) }
    if (!share.ok) return failed(`Lenders' share: ${share.error.toLowerCase()}`)
    fixed = { interest: extra.value, lenderInterest: share.value }
  }

  const plan = planExtension(extendable(loan), { weeks: Number(raw), mode, fixed })
  if (!plan.ok) return failed(plan.error)
  const p = plan.value
  const today = calendarDate(new Date())

  try {
    await db.$transaction(async (tx) => {
      if (p.mode === 'later') {
        await tx.loan.update({
          where: { id: loanId },
          data: {
            dueOn: p.toDueOn,
            nextDueOn: p.nextDueOn,
            termDays: p.terms.termDays,
            interestCentavos: p.terms.interest,
            totalCentavos: p.terms.total,
          },
        })
        await writeFundings(tx, user.id, loanId, p.terms)
        await tx.loanExtension.create({
          data: {
            userId: user.id,
            loanId,
            extendedOn: today,
            fromDueOn: p.fromDueOn,
            toDueOn: p.toDueOn,
            addedDays: p.addedDays,
            addedInterestCentavos: p.addedInterest,
            addedLenderInterestCentavos: p.addedLenderInterest,
          },
        })
        return
      }

      // INTEREST PAID NOW. The settling payment is EXACTLY the interest the
      // borrower handed over — the capital did not change hands, it carries on.
      // A settling row left by an earlier undo is reused, because the database
      // allows only one per loan (see markPaid).
      const existing = loan.payments.find((row) => row.weekNumber === null)
      if (existing) {
        await tx.payment.update({
          where: { id: existing.id },
          data: { paidOn: today, amountCentavos: p.interestPaid, deletedAt: null },
        })
      } else {
        await tx.payment.create({
          data: { userId: user.id, loanId, weekNumber: null, paidOn: today, amountCentavos: p.interestPaid },
        })
      }
      await tx.loan.update({ where: { id: loanId }, data: { status: 'PAID', nextDueOn: p.fromDueOn } })

      const t = p.continuation.terms
      const next = await tx.loan.create({
        data: {
          userId: user.id,
          borrowerId: loan.borrowerId,
          capitalCentavos: loan.capitalCentavos,
          interestBasis: loan.interestBasis,
          borrowerRateBps: loan.interestBasis === 'WEEKLY_RATE' ? loan.borrowerRateBps : null,
          startOn: p.continuation.startOn,
          dueOn: p.continuation.dueOn,
          interestCollection: 'AT_END',
          nextDueOn: t.nextDueOn,
          termDays: t.termDays,
          interestCentavos: t.interest,
          totalCentavos: t.total,
        },
      })
      await writeFundings(tx, user.id, next.id, t)
      await tx.loanExtension.create({
        data: {
          userId: user.id,
          loanId,
          extendedOn: today,
          fromDueOn: p.fromDueOn,
          toDueOn: p.toDueOn,
          addedDays: p.addedDays,
          addedInterestCentavos: p.addedInterest,
          addedLenderInterestCentavos: p.addedLenderInterest,
          interestPaidCentavos: p.interestPaid,
          continuedLoanId: next.id,
        },
      })
    })
  } catch (error) {
    if (isMissingTable(error)) return failed(NOT_READY)
    throw error
  }

  refresh()
  return NO_ERROR
}

/**
 * Take back the LATEST extension of a loan, entered by mistake.
 *
 * The latest only: an earlier one has another stacked on top of it, and
 * unpicking the middle of a chain is a different question. Refused, with the
 * reason, whenever undoing would rewrite money already received:
 *
 *   nothing paid now — the loan goes back to its old due date and figures. Not
 *     if it has since been paid, or a week beyond the old end was collected.
 *   interest paid now — the continuation loan is removed and the original goes
 *     back to running, its interest payment undone. Not if the continuation has
 *     any payment, or anything drawn against it.
 */
export async function undoExtension(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser()
  const extensionId = text(form, 'extensionId')

  try {
    const ext = await db.loanExtension.findFirst({ where: { id: extensionId, userId: user.id } })
    if (!ext) return failed('That extension no longer exists.')

    const latest = await db.loanExtension.findFirst({
      where: { userId: user.id, loanId: ext.loanId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })
    if (latest?.id !== ext.id) return failed('Only the latest extension can be undone.')

    const loan = await loadLoan(user.id, ext.loanId)
    if (!loan) return failed('That loan no longer exists.')

    await db.$transaction(async (tx) => {
      if (ext.continuedLoanId === null) {
        if (loan.status === 'PAID') throw new Refused('This loan has been paid since. Undo the payment first.')
        const current = extendable(loan)
        const fromDueOn = storedCalendarDate(ext.fromDueOn)
        const oldWeeks = Math.round((fromDueOn.getTime() - current.startOn.getTime()) / (DAYS_PER_WEEK * 86_400_000))
        if ([...current.paidWeeks].some((week) => week > oldWeeks)) {
          throw new Refused('A week after the old due date has already been collected. Undo that week first.')
        }
        const lenderShare = current.fundings.filter((f) => !f.isSelf).reduce((sum, f) => sum + f.earnings, 0)
        const terms = loanTerms({
          capital: current.capital,
          startOn: current.startOn,
          dueOn: fromDueOn,
          interest:
            current.interestBasis === 'FIXED_AMOUNT'
              ? {
                  basis: 'FIXED_AMOUNT',
                  interest: centavos(current.interest - ext.addedInterestCentavos),
                  lenderInterest: centavos(lenderShare - ext.addedLenderInterestCentavos),
                }
              : {
                  basis: 'WEEKLY_RATE',
                  borrowerRateBps: current.borrowerRateBps!,
                  adminCutBps: current.fundings.find((f) => !f.isSelf)?.adminCutBps ?? 0,
                },
          collection: current.interestCollection,
          funders: current.fundings.map((f) => ({ lenderId: f.lenderId, isSelf: f.isSelf, principal: f.principal })),
        })
        if (!terms.ok) throw new Refused(terms.error)
        const nextDueOn =
          current.interestCollection === 'WEEKLY'
            ? (nextUnpaidWeek(current.startOn, terms.value.termDays / DAYS_PER_WEEK, current.paidWeeks)?.dueOn ?? fromDueOn)
            : fromDueOn
        await tx.loan.update({
          where: { id: loan.id },
          data: {
            dueOn: fromDueOn,
            nextDueOn,
            termDays: terms.value.termDays,
            interestCentavos: terms.value.interest,
            totalCentavos: terms.value.total,
          },
        })
        await writeFundings(tx, user.id, loan.id, terms.value)
        await tx.loanExtension.delete({ where: { id: ext.id } })
        return
      }

      const continued = await tx.loan.findFirst({
        where: { id: ext.continuedLoanId, userId: user.id },
        select: {
          status: true,
          payments: { where: { deletedAt: null }, select: { id: true } },
          advances: { where: { deletedAt: null }, select: { id: true } },
          extensions: { select: { id: true } },
        },
      })
      if (continued) {
        if (continued.status === 'PAID' || continued.payments.length > 0) {
          throw new Refused('The continued loan has a payment on it. Undo that payment first.')
        }
        if (continued.advances.length > 0) throw new Refused('Money has been drawn against the continued loan. Remove that first.')
        if (continued.extensions.length > 0) throw new Refused('The continued loan has been extended itself. Undo that first.')
        await tx.loan.delete({ where: { id: ext.continuedLoanId } })
      }
      await tx.payment.updateMany({
        where: { loanId: loan.id, userId: user.id, deletedAt: null, ...SETTLING },
        data: { deletedAt: new Date() },
      })
      await tx.loan.update({
        where: { id: loan.id },
        data: { status: 'ACTIVE', nextDueOn: storedCalendarDate(loan.dueOn) },
      })
      await tx.loanExtension.delete({ where: { id: ext.id } })
    })
  } catch (error) {
    if (error instanceof Refused) return failed(error.message)
    if (isMissingTable(error)) return failed(NOT_READY)
    throw error
  }

  refresh()
  return NO_ERROR
}
