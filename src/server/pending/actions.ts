'use server'

import { revalidatePath } from 'next/cache'

import { type Result, ok, err } from '../../lib/money/result.ts'
import {
  DAYS_PER_WEEK,
  describeWeeksError,
  weeksBetween,
} from '../../lib/money/weeks.ts'
import { requireUser } from '../auth/guard.ts'
import { db } from '../db.ts'
import { type FormState, NO_ERROR, amount, date, failed, personName, text } from '../forms.ts'
import { DEFAULT_BORROWER_RATE_BPS, parseRate } from '../loans/terms.ts'

/**
 * Writing loan requests.
 *
 * A request is the cheapest record in the app: a name, an amount, a rate and a
 * length. It creates no Borrower, moves no money, and touches no other table —
 * which is what lets the whole module be added without any existing screen
 * changing its answer.
 *
 * It is still checked as strictly as a loan, because it is the thing a loan
 * will be copied from. A request carrying a length that is not a whole number
 * of weeks would produce interest nobody can reproduce.
 *
 * As everywhere else: requireUser() first, and userId in the WHERE clause of
 * every write. A server action is a public endpoint and a posted id proves
 * nothing.
 */

function refresh(): void {
  revalidatePath('/', 'layout')
}

/** The lengths the dropdown offers, in weeks. Longer than four is Custom dates. */
const WEEK_PRESETS = [1, 2, 3, 4]
const CUSTOM = 'custom'

type Term = { termDays: number; startOn: Date | null }

/**
 * How long the requested loan runs, and when it would start.
 *
 * Two ways in, mirroring the loan form. A preset length is just that — a length,
 * with no start date, because nobody has agreed one yet. Custom dates is for a
 * request that already has a day attached, or a length the four presets do not
 * cover.
 *
 * WHOLE WEEKS EITHER WAY. The rate is per week, so the week count multiplies the
 * interest: weeksBetween is the same refusal the loan form makes, for the same
 * reason, and it names the two dates that would work.
 */
function readTerm(form: FormData): Result<Term, string> {
  const choice = text(form, 'termChoice')

  if (choice !== CUSTOM) {
    const weeks = Number(choice)
    if (!WEEK_PRESETS.includes(weeks)) return err('Choose how long the loan runs.')
    return ok({ termDays: weeks * DAYS_PER_WEEK, startOn: null })
  }

  const startOn = date(form, 'startOn')
  if (!startOn.ok) return err(`Start date: ${startOn.error.toLowerCase()}`)

  const dueOn = date(form, 'dueOn')
  if (!dueOn.ok) return err(`Due date: ${dueOn.error.toLowerCase()}`)

  const weeks = weeksBetween(startOn.value, dueOn.value)
  if (!weeks.ok) return err(describeWeeksError(weeks.error))

  return ok({ termDays: weeks.value * DAYS_PER_WEEK, startOn: startOn.value })
}

export async function createPendingLoan(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser()

  const name = personName(form)
  if (!name.ok) return failed(name.error)

  const capital = amount(form, 'capital')
  if (!capital.ok) return failed(capital.error)

  // A blank rate is the usual 7%, exactly as on the loan form — the placeholder
  // in the box says so, and typing the same number on every request is how a
  // typo gets made.
  const typedRate = text(form, 'borrowerRate')
  const rate = typedRate ? parseRate(typedRate) : ok(DEFAULT_BORROWER_RATE_BPS)
  if (!rate.ok) return failed(rate.error)
  if (rate.value <= 0) return failed('Enter a rate greater than zero.')

  const term = readTerm(form)
  if (!term.ok) return failed(term.error)

  await db.pendingLoan.create({
    data: {
      userId: user.id,
      ...name.value,
      capitalCentavos: capital.value,
      borrowerRateBps: rate.value,
      termDays: term.value.termDays,
      startOn: term.value.startOn,
    },
  })

  refresh()
  return NO_ERROR
}

/**
 * Turn a request down, or drop one that was entered wrong.
 *
 * THIS REALLY DELETES, and the button asks first. Everywhere else in this app
 * "delete" sets deletedAt and Recently Deleted holds the row for thirty days,
 * because destroying it would destroy money history. A request holds none: no
 * cash moved, no lender is owed anything, and nothing anywhere adds these up.
 * Keeping one in Recently Deleted next to real loans and payments would only
 * raise the question of what money it was worth.
 */
export async function deletePendingLoan(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser()

  const { count } = await db.pendingLoan.deleteMany({
    where: { id: text(form, 'pendingId'), userId: user.id },
  })
  if (count === 0) return failed('That request is no longer there.')

  refresh()
  return NO_ERROR
}
