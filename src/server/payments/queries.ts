import { type Centavos, centavos } from '../../lib/money/centavos.ts'
import { db } from '../db.ts'
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

export async function paymentForLoan(userId: string, loanId: string): Promise<PaymentView | null> {
  const payment = await db.payment.findFirst({
    where: { loanId, userId, deletedAt: null },
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
