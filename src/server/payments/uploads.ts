import { randomUUID } from 'node:crypto'

import { proofStoragePath } from '../../lib/proof.ts'
import { putProof, removeProof } from '../storage/proof-bucket.ts'

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
 * The order matters. Files first means a failure leaves nothing recorded and the
 * admin simply tries again; rows first would leave a payment claiming proof that
 * is not there. Anything already uploaded when a later file fails is removed, so
 * a retry does not silently leave orphans behind in a bucket nobody looks at.
 */
export async function uploadAll(userId: string, paymentId: string, files: File[]): Promise<Upload[]> {
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
