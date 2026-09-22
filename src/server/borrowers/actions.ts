'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { requireUser } from '../auth/guard.ts'
import { db } from '../db.ts'
import { type FormState, NO_ERROR, failed, personName, text } from '../forms.ts'
import { borrowerNameTaken, borrowerRestoreBlocked } from '../people.ts'

/**
 * Writing borrowers.
 *
 * Name only — the spec is explicit that nothing else about a borrower is stored,
 * and an empty phone column invites someone to start filling it.
 *
 * As in the lender actions: requireUser() first, and every write carries the
 * userId in its WHERE clause. A server action is a public endpoint; a bare id
 * from the caller is not proof of anything.
 */

function refresh(): void {
  revalidatePath('/', 'layout')
}

const LABELS = ['GOOD', 'OKAY', 'BAD'] as const
type Label = (typeof LABELS)[number]

function asLabel(value: string): Label | null | undefined {
  if (value === '') return null
  return (LABELS as readonly string[]).includes(value) ? (value as Label) : undefined
}

export async function createBorrower(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser()

  const name = personName(form)
  if (!name.ok) return failed(name.error)

  const taken = await borrowerNameTaken(db, user.id, name.value)
  if (taken) return failed(taken)

  await db.borrower.create({ data: { userId: user.id, ...name.value } })
  refresh()
  return NO_ERROR
}

export async function renameBorrower(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser()

  const name = personName(form)
  if (!name.ok) return failed(name.error)

  // Renaming onto somebody else's name makes the same double entry a fresh one
  // would, so it is refused the same way. The row being renamed is excluded, or
  // saving a borrower without changing the name would refuse itself.
  const borrowerId = text(form, 'borrowerId')
  const taken = await borrowerNameTaken(db, user.id, name.value, borrowerId)
  if (taken) return failed(taken)

  const { count } = await db.borrower.updateMany({
    where: { id: borrowerId, userId: user.id },
    data: name.value,
  })
  if (count === 0) return failed('That borrower no longer exists.')

  refresh()
  return NO_ERROR
}

/**
 * The admin's own Good / Okay / Bad, on top of the counted record.
 *
 * It exists because the admin knows things the app cannot see — she is family,
 * he always warns me first. It blocks nothing: there is no warning prompt before
 * lending to a badly-rated borrower, by decision.
 *
 * An empty value clears the label. That is a real choice, not a missing field,
 * so it is distinguished here from a value that is simply not one of the three.
 */
export async function setBorrowerLabel(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser()

  const label = asLabel(text(form, 'label'))
  if (label === undefined) return failed('Choose Good, Okay or Bad.')

  const { count } = await db.borrower.updateMany({
    where: { id: text(form, 'borrowerId'), userId: user.id },
    data: { manualLabel: label },
  })
  if (count === 0) return failed('That borrower no longer exists.')

  refresh()
  return NO_ERROR
}

/**
 * Delete. Their loans and their history come back intact for thirty days.
 *
 * Ends on the borrowers list, the way deleting a loan ends on the loans list.
 * Staying put would leave the admin looking at a profile that is no longer in
 * any list — the delete appeared to do nothing, and the only way to see that
 * it worked would be to navigate away by hand.
 */
export async function deleteBorrower(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser()

  const { count } = await db.borrower.updateMany({
    where: { id: text(form, 'borrowerId'), userId: user.id },
    data: { deletedAt: new Date() },
  })
  if (count === 0) return failed('That borrower no longer exists.')

  refresh()
  redirect('/borrowers')
}

export async function restoreBorrower(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser()

  const borrowerId = text(form, 'borrowerId')

  // Restore is the one door a duplicate can still walk through: adding a fresh
  // row while this one sat in Recently Deleted was allowed on purpose, and
  // bringing this one back would put both names on the list at once. Only LIVE
  // rows count — a second deleted namesake is on no list and blocks nothing.
  const restoring = await db.borrower.findFirst({
    where: { id: borrowerId, userId: user.id },
    select: { firstName: true, lastName: true },
  })
  if (!restoring) return failed('That borrower no longer exists.')

  const clash = await borrowerRestoreBlocked(db, user.id, restoring, borrowerId)
  if (clash) return failed(clash)

  const { count } = await db.borrower.updateMany({
    where: { id: borrowerId, userId: user.id },
    data: { deletedAt: null },
  })
  if (count === 0) return failed('That borrower no longer exists.')

  refresh()
  return NO_ERROR
}
