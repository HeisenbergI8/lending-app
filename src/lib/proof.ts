import { type Result, ok, err } from './money/result.ts'

/**
 * What counts as proof of payment, and where it is kept.
 *
 * Pure rules, so the browser can warn about a file before it is uploaded and the
 * server can refuse the same file if it arrives anyway. A form is a convenience;
 * the server action is a public endpoint, and only its answer is binding.
 *
 * Proof is OPTIONAL BUT FLAGGED. A payment can be recorded with nothing
 * attached — the screenshot is often still on someone else's phone — and the
 * loan carries a "no proof" warning until one arrives. Blocking the payment
 * instead would mean a repayment going unrecorded because a file was missing,
 * which is the worse of the two failures by a wide margin.
 */

/** A phone screenshot, a photo of a receipt, or the chat confirming it as a PDF. */
export const ACCEPTED_PROOF_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
] as const

/** What the file picker offers, so the phone's gallery opens rather than a file tree. */
export const PROOF_ACCEPT_ATTRIBUTE = 'image/*,application/pdf'

/**
 * Per file, after the browser has had its go at shrinking it.
 *
 * Free Supabase storage is small and payment screenshots add up, so this is a
 * real ceiling rather than a formality. It sits under the server action's own
 * body limit on purpose — a file refused here gets a sentence explaining itself,
 * where one refused by the framework gets a generic failure.
 */
export const MAX_PROOF_BYTES = 4 * 1024 * 1024

/** Several files per payment is normal: the GCash screenshot plus the chat confirming it. */
export const MAX_PROOF_FILES = 6

/**
 * The longest edge a stored image keeps.
 *
 * A modern phone camera produces something like 4000px wide, and a GCash receipt
 * is legible at a fraction of that. Storing the original would fill a free-tier
 * bucket with detail nobody will ever look at.
 */
export const MAX_PROOF_EDGE = 1600

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'application/pdf': 'pdf',
}

export function isAcceptedProofType(mimeType: string): boolean {
  return (ACCEPTED_PROOF_TYPES as readonly string[]).includes(mimeType)
}

export function extensionFor(mimeType: string): string {
  return EXTENSIONS[mimeType] ?? 'bin'
}

export type ProofCandidate = { name: string; type: string; size: number }

/** Is this file usable as proof, or what is wrong with it. */
export function checkProofFile(file: ProofCandidate): Result<ProofCandidate, string> {
  if (file.size === 0) return err(`"${file.name}" is empty.`)
  if (!isAcceptedProofType(file.type)) {
    return err(`"${file.name}" is not an image or a PDF.`)
  }
  if (file.size > MAX_PROOF_BYTES) {
    return err(`"${file.name}" is ${describeBytes(file.size)} — the limit is ${describeBytes(MAX_PROOF_BYTES)}.`)
  }
  return ok(file)
}

export function checkProofFiles(files: ProofCandidate[]): Result<ProofCandidate[], string> {
  if (files.length > MAX_PROOF_FILES) {
    return err(`Attach at most ${MAX_PROOF_FILES} files at a time.`)
  }
  for (const file of files) {
    const checked = checkProofFile(file)
    if (!checked.ok) return err(checked.error)
  }
  return ok(files)
}

/**
 * Where a file lives in the bucket.
 *
 * Scoped by user id first, so one account's proof can never be reached by
 * guessing another's path, and named with a random id rather than the uploaded
 * filename — two screenshots really are both called IMG_0042.jpg, and the
 * original name is not worth a collision or an escaping bug.
 */
export function proofStoragePath(userId: string, paymentId: string, fileId: string, mimeType: string): string {
  return `${userId}/${paymentId}/${fileId}.${extensionFor(mimeType)}`
}

/** "2.4 MB" — for a message a person reads, not for arithmetic. */
export function describeBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * How far to shrink an image, keeping its shape.
 *
 * Returns null when it is already small enough — a screenshot that needs no
 * work should be stored untouched rather than re-encoded, which would cost
 * quality for nothing.
 */
export function downscaleTo(width: number, height: number): { width: number; height: number } | null {
  const longest = Math.max(width, height)
  if (longest <= MAX_PROOF_EDGE || longest === 0) return null

  const scale = MAX_PROOF_EDGE / longest
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}
