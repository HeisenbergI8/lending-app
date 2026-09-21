'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { type Centavos, parsePesos } from '../../lib/money/centavos.ts'
import { type Result, ok, err } from '../../lib/money/result.ts'
import { requireUser } from '../auth/guard.ts'
import { db } from '../db.ts'
import { type FormState, NO_ERROR, amount, date, failed, text } from '../forms.ts'
import {
  DEFAULT_ADMIN_CUT_BPS,
  DEFAULT_BORROWER_RATE_BPS,
  type FunderInput,
  loanTerms,
  parseRate,
} from './terms.ts'

/**
 * Creating, correcting and undoing a loan.
 *
 * THE ARITHMETIC HAPPENS ONCE, HERE, and the answers are written to the row.
 * Nothing recalculates afterwards and no job runs weekly — "automated interest
 * computation" in the spec means the app does the sums so the admin does not,
 * not that a scheduler wakes up. A default rate changed next year must not
 * quietly rewrite what a borrower already owes.
 *
 * Every figure comes from loanTerms(), which is pure and tested. This file's job
 * is reading the form, checking the people named really belong to this account,
 * and writing the rows in one transaction.
 */

function refresh(): void {
  revalidatePath('/', 'layout')
}

/** One funding line as the form sends it. Every row submits all four, so indices line up. */
type FunderRow = { lenderId: string; firstName: string; lastName: string; principal: Centavos }

function readFunderRows(form: FormData): Result<FunderRow[], string> {
  const ids = form.getAll('funderLenderId').map(String)
  const amounts = form.getAll('funderAmount').map(String)
  const firstNames = form.getAll('funderFirstName').map(String)
  const lastNames = form.getAll('funderLastName').map(String)

  const rows: FunderRow[] = []
  for (const [index, lenderId] of ids.entries()) {
    const typed = (amounts[index] ?? '').trim()
    const firstName = (firstNames[index] ?? '').trim()
    const lastName = (lastNames[index] ?? '').trim()

    // A row left completely blank is not an error — it is the empty line at the
    // bottom of a form nobody filled in. Skip it rather than refusing to save.
    if (!lenderId && !typed && !firstName && !lastName) continue

    const parsed = parsePesos(typed)
    if (!parsed.ok) return err('Every funder needs an amount in pesos.')
    if (parsed.value <= 0) return err('Every funder needs an amount greater than zero.')

    if (lenderId === 'new') {
      if (!firstName || !lastName) return err('Enter a first and last name for the new lender.')
      rows.push({ lenderId: 'new', firstName, lastName, principal: parsed.value })
    } else {
      if (!lenderId) return err('Choose whose money is on each funding line.')
      rows.push({ lenderId, firstName: '', lastName: '', principal: parsed.value })
    }
  }

  if (rows.length === 0) return err('Say whose money is funding this loan.')
  return ok(rows)
}

type Parsed = {
  borrower: { id: string } | { firstName: string; lastName: string }
  capital: Centavos
  startOn: Date
  dueOn: Date
  borrowerRateBps: number
  adminCutBps: number
  funders: FunderRow[]
}

/** Everything the form said, checked as far as it can be without the database. */
function readForm(form: FormData): Result<Parsed, string> {
  const borrowerId = text(form, 'borrowerId')
  const borrower =
    borrowerId === 'new' || borrowerId === ''
      ? { firstName: text(form, 'borrowerFirstName'), lastName: text(form, 'borrowerLastName') }
      : { id: borrowerId }

  if ('firstName' in borrower && (!borrower.firstName || !borrower.lastName)) {
    return err('Choose a borrower, or enter a first and last name for a new one.')
  }

  const capital = amount(form, 'capital')
  if (!capital.ok) return err(capital.error)

  const startOn = date(form, 'startOn')
  if (!startOn.ok) return err(`Start date: ${startOn.error.toLowerCase()}`)

  const dueOn = date(form, 'dueOn')
  if (!dueOn.ok) return err(`Due date: ${dueOn.error.toLowerCase()}`)

  const borrowerRate = text(form, 'borrowerRate')
  const adminCut = text(form, 'adminCut')
  const borrowerRateBps = borrowerRate ? parseRate(borrowerRate) : ok(DEFAULT_BORROWER_RATE_BPS)
  const adminCutBps = adminCut ? parseRate(adminCut) : ok(DEFAULT_ADMIN_CUT_BPS)
  if (!borrowerRateBps.ok) return err(`Borrower rate: ${borrowerRateBps.error.toLowerCase()}`)
  if (!adminCutBps.ok) return err(`Your cut: ${adminCutBps.error.toLowerCase()}`)

  const funders = readFunderRows(form)
  if (!funders.ok) return err(funders.error)

  return ok({
    borrower,
    capital: capital.value,
    startOn: startOn.value,
    dueOn: dueOn.value,
    borrowerRateBps: borrowerRateBps.value,
    adminCutBps: adminCutBps.value,
    funders: funders.value,
  })
}

/**
 * Turn the named lenders into funders, creating any new ones.
 *
 * Existing lenders are looked up WITH the userId, so an id posted by hand cannot
 * pull another account's lender into this loan. `isSelf` is read from the row
 * rather than taken from the form: whether money is the admin's own decides what
 * rate it earns, and that is not something a form should be able to claim.
 */
async function resolveFunders(
  userId: string,
  rows: FunderRow[],
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
): Promise<Result<FunderInput[], string>> {
  const funders: FunderInput[] = []

  for (const row of rows) {
    if (row.lenderId === 'new') {
      const created = await tx.lender.create({
        data: { userId, firstName: row.firstName, lastName: row.lastName },
      })
      funders.push({ lenderId: created.id, isSelf: false, principal: row.principal })
      continue
    }

    const lender = await tx.lender.findFirst({
      where: { id: row.lenderId, userId },
      select: { id: true, isSelf: true },
    })
    if (!lender) return err('One of the lenders on this loan no longer exists.')
    funders.push({ lenderId: lender.id, isSelf: lender.isSelf, principal: row.principal })
  }

  return ok(funders)
}

async function resolveBorrower(
  userId: string,
  borrower: Parsed['borrower'],
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
): Promise<Result<string, string>> {
  if ('id' in borrower) {
    const found = await tx.borrower.findFirst({ where: { id: borrower.id, userId }, select: { id: true } })
    if (!found) return err('That borrower no longer exists.')
    return ok(found.id)
  }

  const created = await tx.borrower.create({
    data: { userId, firstName: borrower.firstName, lastName: borrower.lastName },
  })
  return ok(created.id)
}

/**
 * Record a new loan.
 *
 * The borrower and any new lender are created in the SAME transaction as the
 * loan. Creating them first and then failing on the dates would leave a person
 * in the list who was never lent anything — a half-entered loan that looks like
 * a real record.
 *
 * On success this redirects to the loan, which throws by design in Next, so it
 * sits outside the transaction.
 */
export async function createLoan(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser()

  const parsed = readForm(form)
  if (!parsed.ok) return failed(parsed.error)
  const input = parsed.value

  let loanId: string
  try {
    loanId = await db.$transaction(async (tx) => {
      const borrowerId = await resolveBorrower(user.id, input.borrower, tx)
      if (!borrowerId.ok) throw new LoanRefused(borrowerId.error)

      const funders = await resolveFunders(user.id, input.funders, tx)
      if (!funders.ok) throw new LoanRefused(funders.error)

      const terms = loanTerms({
        capital: input.capital,
        startOn: input.startOn,
        dueOn: input.dueOn,
        borrowerRateBps: input.borrowerRateBps,
        adminCutBps: input.adminCutBps,
        funders: funders.value,
      })
      if (!terms.ok) throw new LoanRefused(terms.error)

      const loan = await tx.loan.create({
        data: {
          userId: user.id,
          borrowerId: borrowerId.value,
          capitalCentavos: input.capital,
          borrowerRateBps: input.borrowerRateBps,
          startOn: input.startOn,
          dueOn: input.dueOn,
          weeks: terms.value.weeks,
          interestCentavos: terms.value.interest,
          totalCentavos: terms.value.total,
        },
      })

      await tx.loanFunding.createMany({
        data: terms.value.fundings.map((funding) => ({
          userId: user.id,
          loanId: loan.id,
          lenderId: funding.lenderId,
          principalCentavos: funding.principal,
          lenderRateBps: funding.lenderRateBps,
          adminCutBps: funding.adminCutBps,
          earningsCentavos: funding.earnings,
          adminCutCentavos: funding.adminCut,
        })),
      })

      return loan.id
    })
  } catch (error) {
    if (error instanceof LoanRefused) return failed(error.message)
    throw error
  }

  refresh()
  redirect(`/loans/${loanId}`)
}

/**
 * Correct a loan entered wrong.
 *
 * Every figure is computed again from scratch, because that is what "entered
 * wrong" means — the old numbers were answers to the wrong question. The funding
 * rows are replaced rather than patched, so a funder removed from the form is
 * removed from the loan.
 *
 * A PAID loan is refused. Its payment records a total that was agreed and
 * handed over; changing the total underneath it would leave the two disagreeing
 * with nothing to say which is right.
 */
export async function updateLoan(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser()

  const loanId = text(form, 'loanId')
  const parsed = readForm(form)
  if (!parsed.ok) return failed(parsed.error)
  const input = parsed.value

  const existing = await db.loan.findFirst({ where: { id: loanId, userId: user.id }, select: { status: true } })
  if (!existing) return failed('That loan no longer exists.')
  if (existing.status === 'PAID') return failed('A loan that has been paid cannot be edited.')

  try {
    await db.$transaction(async (tx) => {
      const borrowerId = await resolveBorrower(user.id, input.borrower, tx)
      if (!borrowerId.ok) throw new LoanRefused(borrowerId.error)

      const funders = await resolveFunders(user.id, input.funders, tx)
      if (!funders.ok) throw new LoanRefused(funders.error)

      const terms = loanTerms({
        capital: input.capital,
        startOn: input.startOn,
        dueOn: input.dueOn,
        borrowerRateBps: input.borrowerRateBps,
        adminCutBps: input.adminCutBps,
        funders: funders.value,
      })
      if (!terms.ok) throw new LoanRefused(terms.error)

      await tx.loan.update({
        where: { id: loanId },
        data: {
          borrowerId: borrowerId.value,
          capitalCentavos: input.capital,
          borrowerRateBps: input.borrowerRateBps,
          startOn: input.startOn,
          dueOn: input.dueOn,
          weeks: terms.value.weeks,
          interestCentavos: terms.value.interest,
          totalCentavos: terms.value.total,
        },
      })

      await tx.loanFunding.deleteMany({ where: { loanId, userId: user.id } })
      await tx.loanFunding.createMany({
        data: terms.value.fundings.map((funding) => ({
          userId: user.id,
          loanId,
          lenderId: funding.lenderId,
          principalCentavos: funding.principal,
          lenderRateBps: funding.lenderRateBps,
          adminCutBps: funding.adminCutBps,
          earningsCentavos: funding.earnings,
          adminCutCentavos: funding.adminCut,
        })),
      })
    })
  } catch (error) {
    if (error instanceof LoanRefused) return failed(error.message)
    throw error
  }

  refresh()
  redirect(`/loans/${loanId}`)
}

/** Undo a loan. Archived, never destroyed — it comes back whole from the Archive. */
export async function archiveLoan(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser()

  const { count } = await db.loan.updateMany({
    where: { id: text(form, 'loanId'), userId: user.id },
    data: { archivedAt: new Date() },
  })
  if (count === 0) return failed('That loan no longer exists.')

  refresh()
  redirect('/loans')
}

export async function restoreLoan(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser()

  const { count } = await db.loan.updateMany({
    where: { id: text(form, 'loanId'), userId: user.id },
    data: { archivedAt: null },
  })
  if (count === 0) return failed('That loan no longer exists.')

  refresh()
  return NO_ERROR
}

/**
 * A refusal the admin should read, thrown to unwind the transaction.
 *
 * Inside $transaction the only way to abort is to throw, but a refusal is not a
 * crash — the form needs to render it. This carries it out to where it can be
 * turned back into a FormState, and anything that is NOT one of these is a real
 * error and is rethrown untouched.
 */
class LoanRefused extends Error {}
