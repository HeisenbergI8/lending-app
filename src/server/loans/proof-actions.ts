'use server'

import { revalidatePath } from 'next/cache'

import { checkProofFiles } from '../../lib/proof.ts'
import { requireUser } from '../auth/guard.ts'
import { db } from '../db.ts'
import { type FormState, NO_ERROR, failed, text } from '../forms.ts'
import { type Upload, discardUploads, filesFrom, loanProofFolder, uploadAll } from '../payments/uploads.ts'
import { StorageUnavailable } from '../storage/proof-bucket.ts'
import { isMissingTable } from './extensions.ts'
import { LOAN_PROOF_NOT_READY, loanProofRows } from './proofs.ts'

/**
 * Adding and removing the screenshots of a loan being sent, after it was saved.
 *
 * Saving a NEW loan requires one (createLoan). These cover the rest: a second
 * screenshot when the money went in parts, and a first one for a loan recorded
 * before screenshots were required.
 */

export async function addLoanProof(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser()
  const loanId = text(form, 'loanId')

  const files = filesFrom(form, 'proof')
  if (files.length === 0) return failed('Choose a file to attach.')
  const checked = checkProofFiles(files.map((file) => ({ name: file.name, type: file.type, size: file.size })))
  if (!checked.ok) return failed(checked.error)

  const loan = await db.loan.findFirst({ where: { id: loanId, userId: user.id, deletedAt: null }, select: { id: true } })
  if (!loan) return failed('That loan no longer exists.')

  let uploads: Upload[] = []
  try {
    uploads = await uploadAll(user.id, loanProofFolder(loan.id), files)
  } catch (error) {
    if (error instanceof StorageUnavailable) return failed(`Nothing was saved. ${error.message}`)
    throw error
  }

  try {
    await db.loanProof.createMany({ data: loanProofRows(user.id, loan.id, uploads) })
  } catch (error) {
    await discardUploads(uploads)
    if (isMissingTable(error)) return failed(LOAN_PROOF_NOT_READY)
    throw error
  }

  revalidatePath('/', 'layout')
  return NO_ERROR
}

/**
 * Remove one screenshot — but never the last.
 *
 * The owner's rule (2026-10-11): a loan that has its screenshot keeps at least
 * one. Replacing a wrong one means adding the right one first.
 *
 * The file stays in the bucket until the thirty-day purge, like payment proof.
 */
export async function deleteLoanProof(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser()
  const id = text(form, 'loanProofId')

  const proof = await db.loanProof.findFirst({
    where: { id, userId: user.id, deletedAt: null },
    select: { loanId: true },
  })
  if (!proof) return failed('That file no longer exists.')

  const live = await db.loanProof.count({ where: { loanId: proof.loanId, userId: user.id, deletedAt: null } })
  if (live <= 1) return failed('A loan keeps at least one screenshot. Add the right one first, then remove this one.')

  await db.loanProof.updateMany({ where: { id, userId: user.id }, data: { deletedAt: new Date() } })

  revalidatePath('/', 'layout')
  return NO_ERROR
}
