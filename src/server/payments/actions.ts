'use server'

import { randomUUID } from 'node:crypto'

import { revalidatePath } from 'next/cache'

import { checkProofFiles, proofStoragePath } from '../../lib/proof.ts'
import { requireUser } from '../auth/guard.ts'
import { db } from '../db.ts'
import { type FormState, NO_ERROR, date, failed, text } from '../forms.ts'
import { StorageUnavailable, putProof, removeProof } from '../storage/proof-bucket.ts'

/**
 * Recording that a loan was repaid, and keeping the proof.
 *
 * FULL PAYMENT ONLY. The borrower hands over the whole total in one go — there
 * are no partial payments and no installments, so the amount is never typed. It
 * is read from the loan, which means it cannot be mistyped and cannot drift from
 * what was agreed the day the loan was created.
 *
 * PROOF IS OPTIONAL BUT FLAGGED. Marking a loan paid with nothing attached is
 * allowed and shows a warning until a file arrives. Requiring the file would
 * mean a real repayment going unrecorded because a screenshot was still on
 * someone else's phone.
 */

function refresh(): void {
  revalidatePath('/', 'layout')
}

type Upload = { fileId: string; path: string; mimeType: string; sizeBytes: number }

/**
 * Put the files in the bucket BEFORE anything is written to the database.
 *
 * The order matters. Files first means a failure leaves nothing recorded and the
 * admin simply tries again; rows first would leave a payment claiming proof that
 * is not there. Anything already uploaded when a later file fails is removed, so
 * a retry does not silently leave orphans behind in a bucket nobody looks at.
 */
async function uploadAll(userId: string, paymentId: string, files: File[]): Promise<Upload[]> {
  const done: Upload[] = []
  try {
    for (const file of files) {
      const fileId = randomUUID()
      const path = proofStoragePath(userId, paymentId, fileId, file.type)
      await putProof(path, await file.arrayBuffer(), file.type)
      done.push({ fileId, path, mimeType: file.type, sizeBytes: file.size })
    }
    return done
  } catch (error) {
    await Promise.all(done.map((upload) => removeProof(upload.path).catch(() => undefined)))
    throw error
  }
}

/** The files on a form field, minus the empty one a file input submits when untouched. */
function filesFrom(form: FormData, field: string): File[] {
  return form
    .getAll(field)
    .filter((entry): entry is File => entry instanceof File)
    .filter((file) => file.size > 0)
}

/**
 * Mark a loan paid, with the proof attached in the same step.
 *
 * The payment row is upserted rather than created, because undoing a payment
 * archives the row instead of destroying it and `Payment.loanId` is unique — a
 * loan marked paid, undone and paid again must reuse the row it already has.
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
    select: { id: true, status: true, totalCentavos: true, payment: { select: { id: true } } },
  })
  if (!loan) return failed('That loan no longer exists.')
  if (loan.status === 'PAID') return failed('That loan is already marked paid.')

  const paymentId = loan.payment?.id ?? randomUUID()

  let uploads: Upload[] = []
  try {
    uploads = await uploadAll(user.id, paymentId, files)
  } catch (error) {
    if (error instanceof StorageUnavailable) return failed(uploadFailure(error))
    throw error
  }

  try {
    await db.$transaction(async (tx) => {
      await tx.payment.upsert({
        where: { loanId },
        create: {
          id: paymentId,
          userId: user.id,
          loanId,
          paidOn: paidOn.value,
          // Never typed. The total was fixed the day the loan was created.
          amountCentavos: loan.totalCentavos,
        },
        update: { paidOn: paidOn.value, amountCentavos: loan.totalCentavos, archivedAt: null },
      })

      if (uploads.length > 0) {
        await tx.proofFile.createMany({
          data: uploads.map((upload) => ({
            id: upload.fileId,
            userId: user.id,
            paymentId,
            storagePath: upload.path,
            mimeType: upload.mimeType,
            sizeBytes: upload.sizeBytes,
          })),
        })
      }

      await tx.loan.update({ where: { id: loanId }, data: { status: 'PAID' } })
    })
  } catch (error) {
    await Promise.all(uploads.map((upload) => removeProof(upload.path).catch(() => undefined)))
    throw error
  }

  refresh()
  return NO_ERROR
}

/** Attach proof to a payment already recorded — the usual case for "it's on my phone". */
export async function addProof(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser()

  const loanId = text(form, 'loanId')
  const files = filesFrom(form, 'proof')
  if (files.length === 0) return failed('Choose a file to attach.')

  const checked = checkProofFiles(files.map((file) => ({ name: file.name, type: file.type, size: file.size })))
  if (!checked.ok) return failed(checked.error)

  const payment = await db.payment.findFirst({
    where: { loanId, userId: user.id, archivedAt: null },
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
    await db.proofFile.createMany({
      data: uploads.map((upload) => ({
        id: upload.fileId,
        userId: user.id,
        paymentId: payment.id,
        storagePath: upload.path,
        mimeType: upload.mimeType,
        sizeBytes: upload.sizeBytes,
      })),
    })
  } catch (error) {
    await Promise.all(uploads.map((upload) => removeProof(upload.path).catch(() => undefined)))
    throw error
  }

  refresh()
  return NO_ERROR
}

/**
 * Remove one file from a payment.
 *
 * Archived, not deleted — including the file itself, which stays in the bucket.
 * A restored row pointing at a file that was really deleted would be a record
 * that lies about what it has, which is worse than the storage it saves.
 */
export async function archiveProof(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser()

  const { count } = await db.proofFile.updateMany({
    where: { id: text(form, 'proofFileId'), userId: user.id },
    data: { archivedAt: new Date() },
  })
  if (count === 0) return failed('That file no longer exists.')

  refresh()
  return NO_ERROR
}

/**
 * Undo a payment recorded by mistake.
 *
 * The loan goes back to running and the payment row is archived, not destroyed,
 * so marking it paid again reuses the same row and the same proof files. The
 * files are left attached rather than archived alongside: if the payment was
 * recorded in error the screenshots usually still belong to it, and the admin
 * can remove them one at a time if they do not.
 */
export async function undoPayment(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser()
  const loanId = text(form, 'loanId')

  const loan = await db.loan.findFirst({ where: { id: loanId, userId: user.id }, select: { id: true } })
  if (!loan) return failed('That loan no longer exists.')

  await db.$transaction(async (tx) => {
    await tx.payment.updateMany({
      where: { loanId, userId: user.id },
      data: { archivedAt: new Date() },
    })
    await tx.loan.update({ where: { id: loanId }, data: { status: 'ACTIVE' } })
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
  return `Nothing was recorded — ${error.message}`
}
