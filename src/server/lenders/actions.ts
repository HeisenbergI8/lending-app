'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { requireUser } from '../auth/guard.ts'
import { db } from '../db.ts'
import { type FormState, NO_ERROR, amount, date, failed, personName, text } from '../forms.ts'
import { lenderNameTaken, lenderRestoreBlocked } from '../people.ts'

/**
 * Writing lenders and their money in and out.
 *
 * Every action calls requireUser() first and scopes its write by that id. A
 * server action is a public HTTP endpoint — anyone can post to it — so the check
 * belongs here, in the action, and not in the page that renders the button.
 *
 * Updates and deletes go through updateMany/findFirst with the userId in the
 * WHERE clause rather than update({ where: { id } }). A bare id is supplied by
 * the caller; on its own it would let one account edit another's rows.
 */

/**
 * Refresh everything below the root layout.
 *
 * Deliberately blunt. A deposit changes this lender's page, the lenders list AND
 * the dashboard's floating total, and enumerating those three is a list that goes
 * stale the first time a screen is added. One admin, a handful of pages — the
 * cost of over-refreshing is nothing next to the cost of a figure that is quietly
 * out of date.
 */
function refresh(): void {
  revalidatePath('/', 'layout')
}

export async function createLender(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser()

  const name = personName(form)
  if (!name.ok) return failed(name.error)

  const taken = await lenderNameTaken(db, user.id, name.value)
  if (taken) return failed(taken)

  await db.lender.create({ data: { userId: user.id, ...name.value } })
  refresh()
  return NO_ERROR
}

export async function renameLender(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser()

  const id = text(form, 'lenderId')
  const name = personName(form)
  if (!name.ok) return failed(name.error)

  // Same rule as a fresh lender, minus the row being renamed — see renameBorrower.
  const taken = await lenderNameTaken(db, user.id, name.value, id)
  if (taken) return failed(taken)

  const { count } = await db.lender.updateMany({
    where: { id, userId: user.id },
    data: name.value,
  })
  if (count === 0) return failed('That lender no longer exists.')

  refresh()
  return NO_ERROR
}

/**
 * Delete — which here means "hide it and start a thirty-day clock".
 *
 * The row keeps its loans and its history and comes back intact from Recently
 * Deleted for a month. A lender with money still out on loan can be deleted:
 * that is the admin's call, and the loans keep pointing at them either way.
 *
 * The admin's own pot is the exception. Deleting it would leave mixed-funding
 * loans with nowhere to record the admin's own capital, and there is no way back
 * to it from the lenders list once it is hidden.
 */
export async function deleteLender(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser()
  const id = text(form, 'lenderId')

  const lender = await db.lender.findFirst({ where: { id, userId: user.id } })
  if (!lender) return failed('That lender no longer exists.')
  if (lender.isSelf) return failed('The Admin pot cannot be deleted.')

  await db.lender.updateMany({ where: { id, userId: user.id }, data: { deletedAt: new Date() } })
  refresh()
  // Ends on the lenders list. Staying on a profile that is no longer in any
  // list reads as "nothing happened", which is the opposite of what happened.
  redirect('/lenders')
}

export async function restoreLender(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser()

  const lenderId = text(form, 'lenderId')

  // Same unwatched door as restoreBorrower — see the comment there.
  const restoring = await db.lender.findFirst({
    where: { id: lenderId, userId: user.id },
    select: { firstName: true, lastName: true },
  })
  if (!restoring) return failed('That lender no longer exists.')

  const clash = await lenderRestoreBlocked(db, user.id, restoring, lenderId)
  if (clash) return failed(clash)

  const { count } = await db.lender.updateMany({
    where: { id: lenderId, userId: user.id },
    data: { deletedAt: null },
  })
  if (count === 0) return failed('That lender no longer exists.')

  refresh()
  return NO_ERROR
}

/**
 * Money in or money out — "John Ross added ₱100,000 on Jan 5".
 *
 * A withdrawal is recorded even when it takes the lender's floating funds
 * negative. The app records what happened; it does not decide that it cannot
 * have. Blocking here would leave the admin unable to enter a real transaction,
 * and the negative figure on the profile says more than a refusal would.
 */
export async function recordTransaction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser()

  const lenderId = text(form, 'lenderId')
  const type = text(form, 'type')
  if (type !== 'DEPOSIT' && type !== 'WITHDRAWAL') return failed('Choose money in or money out.')

  const value = amount(form, 'amount')
  if (!value.ok) return failed(value.error)

  const occurredOn = date(form, 'occurredOn')
  if (!occurredOn.ok) return failed(occurredOn.error)

  const note = text(form, 'note')

  const lender = await db.lender.findFirst({ where: { id: lenderId, userId: user.id } })
  if (!lender) return failed('That lender no longer exists.')

  await db.lenderTransaction.create({
    data: {
      userId: user.id,
      lenderId,
      type,
      amountCentavos: value.value,
      occurredOn: occurredOn.value,
      note: note || null,
    },
  })

  refresh()
  return NO_ERROR
}

/** Undo a transaction entered wrong. Kept for thirty days, so the correction is itself a record. */
export async function deleteTransaction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser()

  const { count } = await db.lenderTransaction.updateMany({
    where: { id: text(form, 'transactionId'), userId: user.id },
    data: { deletedAt: new Date() },
  })
  if (count === 0) return failed('That entry no longer exists.')

  refresh()
  return NO_ERROR
}

export async function restoreTransaction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser()

  const { count } = await db.lenderTransaction.updateMany({
    where: { id: text(form, 'transactionId'), userId: user.id },
    data: { deletedAt: null },
  })
  if (count === 0) return failed('That entry no longer exists.')

  refresh()
  return NO_ERROR
}
