import { db } from '../db.ts'
import { type ProofFileView } from '../payments/queries.ts'
import { type Upload } from '../payments/uploads.ts'
import { signProof, storageConfigured } from '../storage/proof-bucket.ts'
import { isMissingTable } from './extensions.ts'

/**
 * The screenshots of a loan being SENT — reading them, and the rows to write.
 *
 * Signed per render, like payment proof (see payments/queries.ts): the bucket
 * is private and a link stops working minutes after the page is drawn.
 */

export type LoanProofs = {
  /** False until the LoanProof table exists. The page then shows nothing rather than an error. */
  ready: boolean
  files: ProofFileView[]
}

export async function proofsForLoan(userId: string, loanId: string): Promise<LoanProofs> {
  let rows: { id: string; mimeType: string; sizeBytes: number; storagePath: string }[]
  try {
    rows = await db.loanProof.findMany({
      where: { loanId, userId, deletedAt: null },
      orderBy: { uploadedAt: 'asc' },
      select: { id: true, mimeType: true, sizeBytes: true, storagePath: true },
    })
  } catch (error) {
    if (isMissingTable(error)) return { ready: false, files: [] }
    throw error
  }

  const configured = storageConfigured()
  const files = await Promise.all(
    rows.map(async (file) => ({
      id: file.id,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      isPdf: file.mimeType === 'application/pdf',
      url: configured ? await signProof(file.storagePath).catch(() => null) : null,
    })),
  )
  return { ready: true, files }
}

/** The LoanProof rows for a set of uploads, ready for createMany. */
export function loanProofRows(userId: string, loanId: string, uploads: Upload[]) {
  return uploads.map((upload) => ({
    id: upload.fileId,
    userId,
    loanId,
    storagePath: upload.path,
    mimeType: upload.mimeType,
    sizeBytes: upload.sizeBytes,
  }))
}

/** Said when the LoanProof table has not been added to the database yet. */
export const LOAN_PROOF_NOT_READY =
  'Loan screenshots need a one-time update to the database first (the LoanProof table). Nothing was saved.'
