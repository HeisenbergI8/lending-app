import { type Centavos, centavos } from '../../lib/money/centavos.ts'
import { db } from '../db.ts'
import { SETTLING } from './settled.ts'
import { signProof, storageConfigured } from '../storage/proof-bucket.ts'

/**
 * Reading a payment and its proof.
 *
 * The links are signed HERE, per render, and last minutes. The bucket is
 * private, so there is no URL to store — which is the point: a screenshot of
 * somebody's GCash transfer should not sit behind an address that keeps working
 * after it is pasted somewhere it should not be.
 */

export type ProofFileView = {
  id: string
  mimeType: string
  sizeBytes: number
  isPdf: boolean
  /** Null when storage is not configured, or the link could not be minted. */
  url: string | null
}

export type PaymentView = {
  paidOn: Date
  amount: Centavos
  files: ProofFileView[]
}

/**
 * The payment that SETTLED a loan, with its proof. Null while it is running.
 *
 * `...SETTLING` is load-bearing and was not needed before weekly loans. Without
 * it this is a findFirst over up to twenty rows with no ordering, so the loan
 * page would show whichever one Postgres handed back — a weekly instalment
 * sitting where the settlement belongs. Every loan made before this feature has
 * exactly one payment, so no test written before it could catch this.
 *
 * It is also what keeps the signing cheap. A weekly loan's twenty payments can
 * carry forty files between them, and minting forty signed links on one render
 * is not what the comment below means by "a handful". A week's own proof is
 * fetched when that week is opened; the schedule only carries a flag.
 */
export async function paymentForLoan(userId: string, loanId: string): Promise<PaymentView | null> {
  const payment = await db.payment.findFirst({
    where: { loanId, userId, deletedAt: null, ...SETTLING },
    select: {
      paidOn: true,
      amountCentavos: true,
      proofFiles: {
        where: { deletedAt: null },
        orderBy: { uploadedAt: 'asc' },
        select: { id: true, mimeType: true, sizeBytes: true, storagePath: true },
      },
    },
  })
  if (!payment) return null

  const configured = storageConfigured()

  // One round trip per file, in parallel. A payment carries a handful of files,
  // not a gallery, so this is two or three requests rather than a queue.
  const files = await Promise.all(
    payment.proofFiles.map(async (file) => ({
      id: file.id,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      isPdf: file.mimeType === 'application/pdf',
      url: configured ? await signProof(file.storagePath).catch(() => null) : null,
    })),
  )

  return { paidOn: payment.paidOn, amount: centavos(payment.amountCentavos), files }
}
