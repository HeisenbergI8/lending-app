import { type Centavos, centavos } from '../../lib/money/centavos.ts'
import { type LenderLedger, type LenderPosition, EMPTY_LEDGER, lenderPosition } from '../../lib/money/floating.ts'
import { type LoanState, loanState } from '../../lib/loan-state.ts'
import { db } from '../db.ts'

/**
 * Reading lenders and their money.
 *
 * Every query here takes a userId and filters on it. Not because a join could not
 * reach it, but because a filter you apply directly is one that cannot be
 * forgotten: the demo account a recruiter logs into must never see a real
 * borrower's name and debt.
 *
 * Floating funds is NEVER read from a column. It is derived on every read from
 * the transactions and fundings that produced it — see lib/money/floating.ts.
 */

export type LenderSummary = {
  id: string
  firstName: string
  lastName: string
  /** The admin's own pot. Its money earns the full borrower rate. */
  isSelf: boolean
  position: LenderPosition
}

export type LenderFunding = {
  loanId: string
  borrowerId: string
  borrowerName: string
  principal: Centavos
  earnings: Centavos
  dueOn: Date
  state: LoanState
}

export type LenderTransactionRow = {
  id: string
  type: 'DEPOSIT' | 'WITHDRAWAL'
  amount: Centavos
  occurredOn: Date
  note: string | null
}

export type LenderDetail = LenderSummary & {
  /** Where this lender's money is right now: one row per loan still running. */
  fundings: LenderFunding[]
  /** Loans of theirs that have been repaid. The track record, kept forever. */
  settled: LenderFunding[]
  transactions: LenderTransactionRow[]
}

/**
 * Every lender's ledger in two queries, not two per lender.
 *
 * Aggregation happens in JS rather than SQL deliberately. The sums depend on the
 * loan's status AND on whose cut a row carries — the admin's 2% belongs to the
 * admin, not to the lender the funding row names — which is a join and a CASE in
 * SQL and four additions here. One admin's ledger is hundreds of rows, not
 * millions; clarity wins at this size.
 */
async function ledgers(userId: string): Promise<Map<string, LenderLedger>> {
  const [transactions, fundings, self] = await Promise.all([
    db.lenderTransaction.groupBy({
      by: ['lenderId', 'type'],
      where: { userId, archivedAt: null },
      _sum: { amountCentavos: true },
    }),
    db.loanFunding.findMany({
      where: { userId, loan: { archivedAt: null } },
      select: {
        lenderId: true,
        principalCentavos: true,
        earningsCentavos: true,
        adminCutCentavos: true,
        loan: { select: { status: true } },
      },
    }),
    db.lender.findFirst({ where: { userId, isSelf: true }, select: { id: true } }),
  ])

  const byLender = new Map<string, LenderLedger>()
  const ledger = (id: string): LenderLedger => {
    const existing = byLender.get(id)
    if (existing) return existing
    const created = { ...EMPTY_LEDGER }
    byLender.set(id, created)
    return created
  }

  for (const row of transactions) {
    const entry = ledger(row.lenderId)
    const sum = row._sum.amountCentavos ?? 0
    if (row.type === 'DEPOSIT') entry.deposits = centavos(entry.deposits + sum)
    else entry.withdrawals = centavos(entry.withdrawals + sum)
  }

  for (const row of fundings) {
    const entry = ledger(row.lenderId)
    const settled = row.loan.status === 'PAID'

    if (settled) entry.settledEarnings = centavos(entry.settledEarnings + row.earningsCentavos)
    else {
      entry.activePrincipal = centavos(entry.activePrincipal + row.principalCentavos)
      entry.pendingEarnings = centavos(entry.pendingEarnings + row.earningsCentavos)
    }

    // The cut on this row is the ADMIN's, wherever the principal came from. On a
    // row the admin funded themselves it is zero, so this needs no branch.
    if (self) {
      const admin = ledger(self.id)
      if (settled) admin.settledAdminCuts = centavos(admin.settledAdminCuts + row.adminCutCentavos)
      else admin.pendingAdminCuts = centavos(admin.pendingAdminCuts + row.adminCutCentavos)
    }
  }

  return byLender
}

/** Everyone whose money is in play, the admin's own pot first. */
export async function listLenders(userId: string): Promise<LenderSummary[]> {
  const [lenders, byLender] = await Promise.all([
    db.lender.findMany({
      where: { userId, archivedAt: null },
      orderBy: [{ isSelf: 'desc' }, { firstName: 'asc' }, { lastName: 'asc' }],
    }),
    ledgers(userId),
  ])

  return lenders.map((lender) => ({
    id: lender.id,
    firstName: lender.firstName,
    lastName: lender.lastName,
    isSelf: lender.isSelf,
    position: lenderPosition(byLender.get(lender.id) ?? EMPTY_LEDGER),
  }))
}

/**
 * One lender, with where their money is.
 *
 * This is the question the profile exists to answer — "where is John Ross's money
 * right now?" — without opening every loan to find out.
 */
export async function getLender(userId: string, lenderId: string): Promise<LenderDetail | null> {
  const lender = await db.lender.findFirst({ where: { id: lenderId, userId } })
  if (!lender) return null

  const [byLender, fundings, transactions] = await Promise.all([
    ledgers(userId),
    db.loanFunding.findMany({
      where: { userId, lenderId, loan: { archivedAt: null } },
      select: {
        principalCentavos: true,
        earningsCentavos: true,
        loan: {
          select: {
            id: true,
            status: true,
            dueOn: true,
            borrower: { select: { id: true, firstName: true, lastName: true } },
          },
        },
      },
      orderBy: { loan: { dueOn: 'asc' } },
    }),
    db.lenderTransaction.findMany({
      where: { userId, lenderId, archivedAt: null },
      orderBy: [{ occurredOn: 'desc' }, { createdAt: 'desc' }],
    }),
  ])

  const rows: LenderFunding[] = fundings.map((row) => ({
    loanId: row.loan.id,
    borrowerId: row.loan.borrower.id,
    borrowerName: `${row.loan.borrower.firstName} ${row.loan.borrower.lastName}`,
    principal: centavos(row.principalCentavos),
    earnings: centavos(row.earningsCentavos),
    dueOn: row.loan.dueOn,
    state: loanState(row.loan.status, row.loan.dueOn),
  }))

  return {
    id: lender.id,
    firstName: lender.firstName,
    lastName: lender.lastName,
    isSelf: lender.isSelf,
    position: lenderPosition(byLender.get(lender.id) ?? EMPTY_LEDGER),
    fundings: rows.filter((row) => row.state !== 'paid'),
    settled: rows.filter((row) => row.state === 'paid'),
    transactions: transactions.map((row) => ({
      id: row.id,
      type: row.type,
      amount: centavos(row.amountCentavos),
      occurredOn: row.occurredOn,
      note: row.note,
    })),
  }
}
