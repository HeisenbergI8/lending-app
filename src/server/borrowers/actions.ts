'use server'

import { revalidatePath } from 'next/cache'

import { requireUser } from '../auth/guard.ts'
import { db } from '../db.ts'
import { type FormState, NO_ERROR, failed, personName, text } from '../forms.ts'

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

  await db.borrower.create({ data: { userId: user.id, ...name.value } })
  refresh()
  return NO_ERROR
}

export async function renameBorrower(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser()

  const name = personName(form)
  if (!name.ok) return failed(name.error)

  const { count } = await db.borrower.updateMany({
    where: { id: text(form, 'borrowerId'), userId: user.id },
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

/** Archive, not delete. Their loans and their history come back intact. */
export async function archiveBorrower(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser()

  const { count } = await db.borrower.updateMany({
    where: { id: text(form, 'borrowerId'), userId: user.id },
    data: { archivedAt: new Date() },
  })
  if (count === 0) return failed('That borrower no longer exists.')

  refresh()
  return NO_ERROR
}

export async function restoreBorrower(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser()

  const { count } = await db.borrower.updateMany({
    where: { id: text(form, 'borrowerId'), userId: user.id },
    data: { archivedAt: null },
  })
  if (count === 0) return failed('That borrower no longer exists.')

  refresh()
  return NO_ERROR
}
