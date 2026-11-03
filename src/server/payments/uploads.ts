import { randomUUID } from 'node:crypto'

import { proofContentMatches, proofStoragePath } from '../../lib/proof.ts'
import { StorageUnavailable, putProof, removeProof } from '../storage/proof-bucket.ts'

/**
 * Getting proof files into the bucket, for every kind of payment.
 *
 * EXTRACTED, NOT COPIED. These were private to payments/actions.ts until a
 * weekly instalment needed the same thing. The bucket-before-rows ordering and
 * the cleanup-on-failure loop are a trap named in CONVENTIONS.md, and two
 * copies of them is two chances to lose one.
 */

export type Upload = { fileId: string; path: string; mimeType: string; sizeBytes: number }

/**
 * Put the files in the bucket BEFORE anything is written to the database.
 *
 * `folder` is the payment's id for payment proof, and `loanProofFolder(loanId)`
 * for the screenshot of a loan being sent.
 *
 * The order matters. Files first means a failure leaves nothing recorded and the
 * admin simply tries again; rows first would leave a payment claiming proof that
 * is not there. Anything already uploaded when a later file fails is removed, so
 * a retry does not silently leave orphans behind in a bucket nobody looks at.
 */
/**
 * A file whose content is not the image or PDF its name claims. A kind of
 * StorageUnavailable on purpose: every caller already turns that into
 * "Nothing was saved. <reason>", so this refusal reads the same everywhere
 * without touching each action.
 */
export class NotRealProof extends StorageUnavailable {}

export async function uploadAll(userId: string, folder: string, files: File[]): Promise<Upload[]> {
  // Every file is checked before ANY is stored, so a bad one leaves nothing behind.
  const contents = await Promise.all(files.map((file) => file.arrayBuffer()))
  files.forEach((file, i) => {
    if (!proofContentMatches(file.type, new Uint8Array(contents[i], 0, Math.min(16, contents[i].byteLength)))) {
      throw new NotRealProof(`"${file.name}" is not really an image or a PDF. Choose the screenshot itself.`)
    }
  })
  const done: Upload[] = []
  try {
    for (const [i, file] of files.entries()) {
      const fileId = randomUUID()
      const path = proofStoragePath(userId, folder, fileId, file.type)
      await putProof(path, contents[i], file.type)
      done.push({ fileId, path, mimeType: file.type, sizeBytes: file.size })
    }
    return done
  } catch (error) {
    await Promise.all(done.map((upload) => removeProof(upload.path).catch(() => undefined)))
    throw error
  }
}

/** Where a loan's own screenshots go: beside its payments' folders, never inside one. */
export function loanProofFolder(loanId: string): string {
  return `loan-${loanId}`
}

/** Undo the uploads when the rows they belong to could not be written. */
export async function discardUploads(uploads: Upload[]): Promise<void> {
  await Promise.all(uploads.map((upload) => removeProof(upload.path).catch(() => undefined)))
}

/** The files on a form field, minus the empty one a file input submits when untouched. */
export function filesFrom(form: FormData, field: string): File[] {
  return form
    .getAll(field)
    .filter((entry): entry is File => entry instanceof File)
    .filter((file) => file.size > 0)
}

/** The ProofFile rows for a set of uploads, ready for createMany. */
export function proofRows(userId: string, paymentId: string, uploads: Upload[]) {
  return uploads.map((upload) => ({
    id: upload.fileId,
    userId,
    paymentId,
    storagePath: upload.path,
    mimeType: upload.mimeType,
    sizeBytes: upload.sizeBytes,
  }))
}
