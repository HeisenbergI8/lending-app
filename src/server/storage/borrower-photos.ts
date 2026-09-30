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
 * TWO FILES PER BORROWER. `<id>.jpg` is the small square the circles use, on
 * every list; `<id>-full.jpg` is the whole picture, uncropped and sharper, for
 * the full-screen view on their page (added 2026-09-30). Lists never load the
 * big one, so a screen of twenty faces stays a few hundred kilobytes.
 *
 * A photo saved before the full view existed has no `-full` file; the viewer
 * then shows the square one.
 */
const FULL = '-full.jpg'
const fullPath = (userId: string, borrowerId: string) => `${folder(userId)}${borrowerId}${FULL}`

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
        .filter((file) => file.name.endsWith('.jpg') && !file.name.endsWith(FULL))
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

/**
 * A link to one borrower's full picture, or null when there is none — a photo
 * from before the full view, or storage not set up. The caller falls back to
 * the square one.
 */
export async function borrowerFullPhotoUrl(userId: string, borrowerId: string): Promise<string | null> {
  if (!storageConfigured()) return null
  try {
    const path = fullPath(userId, borrowerId)
    return (await signMany([path])).get(path) ?? null
  } catch {
    return null
  }
}

/**
 * The full picture goes FIRST. If it fails nothing has changed; if the square
 * then fails, the old circle still shows while the new full picture waits to
 * be replaced by the next try — never a circle pointing at nothing.
 */
export async function saveBorrowerPhoto(
  userId: string,
  borrowerId: string,
  square: ArrayBuffer,
  full: ArrayBuffer | null,
): Promise<void> {
  if (full) await replaceFile(fullPath(userId, borrowerId), full, 'image/jpeg')
  // No full picture sent: the old one, of the previous photo, must not stay
  // behind to be shown under a new face.
  else await removeProof(fullPath(userId, borrowerId))
  await replaceFile(borrowerPhotoPath(userId, borrowerId), square, 'image/jpeg')
}

/** Both files, each tried even if the other fails; the first failure is then reported. */
export async function removeBorrowerPhoto(userId: string, borrowerId: string): Promise<void> {
  const results = await Promise.allSettled([
    removeProof(borrowerPhotoPath(userId, borrowerId)),
    removeProof(fullPath(userId, borrowerId)),
  ])
  const failed = results.find((result) => result.status === 'rejected')
  if (failed) throw (failed as PromiseRejectedResult).reason
}
