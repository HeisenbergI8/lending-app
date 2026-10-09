import { Prisma } from '@prisma/client'

import { type Centavos, centavos } from '../../lib/money/centavos.ts'
import { db } from '../db.ts'

/**
 * Reading a loan's extensions.
 *
 * EVERY READ HERE SURVIVES A MISSING TABLE. LoanExtension arrives by a migration
 * the Admin applies to the live database by hand, and the code can reach the live
 * site before that happens. Until it does, Postgres answers "table does not
 * exist" (Prisma P2021); these functions turn that into "no extensions", so
 * every screen renders as it did before, and `ready` lets the Extend button say
 * it is waiting rather than fail.
 */

export function isMissingTable(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2021'
}

export type ExtensionRow = {
  id: string
  extendedOn: Date
  fromDueOn: Date
  toDueOn: Date
  addedDays: number
  addedInterest: Centavos
  interestPaid: Centavos
  /** The loan the capital carried on as, when the interest was paid now. */
  continuedLoanId: string | null
}

export type LoanExtensions = {
  /** False until the LoanExtension table exists. */
  ready: boolean
  /** Oldest first. */
  rows: ExtensionRow[]
  /** Set on a loan that is the continuation of another: that loan, and when. */
  continuedFrom: { loanId: string; on: Date } | null
}

export async function extensionsForLoan(userId: string, loanId: string): Promise<LoanExtensions> {
  try {
    const [rows, from] = await Promise.all([
      db.loanExtension.findMany({ where: { userId, loanId }, orderBy: { createdAt: 'asc' } }),
      db.loanExtension.findFirst({ where: { userId, continuedLoanId: loanId }, select: { loanId: true, extendedOn: true } }),
    ])
    return {
      ready: true,
      rows: rows.map((row) => ({
        id: row.id,
        extendedOn: row.extendedOn,
        fromDueOn: row.fromDueOn,
        toDueOn: row.toDueOn,
        addedDays: row.addedDays,
        addedInterest: centavos(row.addedInterestCentavos),
        interestPaid: centavos(row.interestPaidCentavos),
        continuedLoanId: row.continuedLoanId,
      })),
      continuedFrom: from ? { loanId: from.loanId, on: from.extendedOn } : null,
    }
  } catch (error) {
    if (isMissingTable(error)) return { ready: false, rows: [], continuedFrom: null }
    throw error
  }
}

export type ExtensionFlags = {
  /** Loans with at least one extension of their own. */
  extended: Set<string>
  /** Loans closed by an extension where the interest was paid (the capital carried on). */
  closed: Set<string>
  /** Loans that are the continuation of such an extension. */
  continued: Set<string>
}

/**
 * Which loans on the account have been extended, for the "Extended" tag on lists
 * and for the track record. One small query over the whole account: the table
 * holds one row per extension, a handful per borrower at most.
 */
export async function extensionFlags(userId: string): Promise<ExtensionFlags> {
  const flags: ExtensionFlags = { extended: new Set(), closed: new Set(), continued: new Set() }
  try {
    const rows = await db.loanExtension.findMany({
      where: { userId },
      select: { loanId: true, continuedLoanId: true },
    })
    for (const row of rows) {
      flags.extended.add(row.loanId)
      if (row.continuedLoanId) {
        flags.closed.add(row.loanId)
        flags.continued.add(row.continuedLoanId)
      }
    }
    return flags
  } catch (error) {
    if (isMissingTable(error)) return flags
    throw error
  }
}

/** The tag on a loan card: it was extended, or it is what an extended loan carried on as. */
export function showsExtended(flags: ExtensionFlags, loanId: string): boolean {
  return flags.extended.has(loanId) || flags.continued.has(loanId)
}

/** Whether this loan was closed by an extension where the interest was paid now. */
export async function closedByExtension(userId: string, loanId: string): Promise<boolean> {
  try {
    const row = await db.loanExtension.findFirst({
      where: { userId, loanId, continuedLoanId: { not: null } },
      select: { id: true },
    })
    return row !== null
  } catch (error) {
    if (isMissingTable(error)) return false
    throw error
  }
}
