import { listFolder, removeProof, replaceFile, signMany, storageConfigured } from './proof-bucket.ts'

/**
 * Borrower photos (added 2026-09-30), kept in the same private bucket as the
 * payment proofs.
 *
 * NO DATABASE COLUMN, ON PURPOSE. A photo lives at a path made from the
 * borrower's id — borrower-photos/<userId>/<borrowerId>.jpg — and whether a
 * borrower has one is answered by listing that folder. A new column would need
 * a migration run by hand against the live database before the code that reads
 * it deployed, or every borrower screen would fail; this needs nothing but the
 * bucket the app already has.
 *
 * Private like everything else in the bucket: a face is as personal as a
 * payment screenshot, so the screen gets short-lived signed links.
 */

const folder = (userId: string) => `borrower-photos/${userId}/`
export const borrowerPhotoPath = (userId: string, borrowerId: string) => `${folder(userId)}${borrowerId}.jpg`

/**
 * A link to every borrower's photo on the account, by borrower id. Two requests
 * however many faces: one list, one batch of signatures.
 *
 * EMPTY RATHER THAN BROKEN. Storage not configured, or not answering, means
 * the initials show as they always have — never an error page over a picture.
 */
export async function borrowerPhotoUrls(userId: string): Promise<Map<string, string>> {
  if (!storageConfigured()) return new Map()
  try {
    const files = await listFolder(folder(userId))
    const byPath = new Map(
      files
        .filter((file) => file.name.endsWith('.jpg'))
        .map((file) => [`${folder(userId)}${file.name}`, file.name.slice(0, -'.jpg'.length)] as const),
    )
    const signed = await signMany([...byPath.keys()])
    const urls = new Map<string, string>()
    for (const [path, borrowerId] of byPath) {
      const url = signed.get(path)
      if (url) urls.set(borrowerId, url)
    }
    return urls
  } catch {
    return new Map()
  }
}

export async function saveBorrowerPhoto(userId: string, borrowerId: string, jpeg: ArrayBuffer): Promise<void> {
  await replaceFile(borrowerPhotoPath(userId, borrowerId), jpeg, 'image/jpeg')
}

export async function removeBorrowerPhoto(userId: string, borrowerId: string): Promise<void> {
  await removeProof(borrowerPhotoPath(userId, borrowerId))
}
