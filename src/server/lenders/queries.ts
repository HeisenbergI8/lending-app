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
  /** How long the loan runs, start to due. Days for every loan; said in weeks. */
  termDays: number
  dueOn: Date
  /** The day the borrower repaid, on a loan that has been settled. Null while it runs. */
  paidOn: Date | null
  state: LoanState
}

export type LenderTransactionRow = {
  id: string
  type: 'DEPOSIT' | 'WITHDRAWAL'
  amount: Centavos
  occurredOn: Date
  note: string | null
  /**
   * The loan this was drawn against, on an advance. Null on an ordinary
   * deposit or withdrawal, which is most of them.
   */
  against: { loanId: string; borrowerName: string } | null
}

/**
 * One slice of the Admin's cut: what was taken, on whose money, in whose loan.
 *
 * ONE ROW PER FUNDING ROW, not per loan. The cut is charged on a lender's
 * capital, so a loan funded by two lenders yields two of these — which is the
 * only way the breakdown can name the money each one came from.
 */
export type AdminCutRow = {
  loanId: string
  borrowerName: string
  /** Whose capital the cut was taken on. Never the Admin's own: that row's cut is zero. */
  lenderName: string
  cut: Centavos
  /** How long the loan runs, start to due. Days for every loan; said in weeks. */
  termDays: number
  dueOn: Date
  paidOn: Date | null
  state: LoanState
}

/** One month of a lender's pot: what was working, and what was sitting idle. */
export type LenderMonth = {
  label: string
  outOnLoan: Centavos
  floating: Centavos
}

export type LenderDetail = LenderSummary & {
  /**
   * The weekly rates this lender's money actually runs at, lowest first.
   *
   * Read from the funding rows rather than assumed, because the rate is set per
   * loan: a profile that states a flat "5% a week" is a sentence that quietly
   * becomes false the first time a loan is written at anything else.
   */
  rates: number[]
  /**
   * How many of their funding rows are on loans charging a FIXED AMOUNT of
   * interest, which carry no rate at all and so appear nowhere in `rates`.
   *
   * Counted rather than dropped: without it the profile would describe a pot
   * using only the loans that happen to have a percentage, and say nothing about
   * the rest.
   */
  fixedAmountLoans: number
  /** Where this lender's money is right now: one row per loan still running. */
  fundings: LenderFunding[]
  /** Loans of theirs that have been repaid. The track record, kept forever. */
  settled: LenderFunding[]
  transactions: LenderTransactionRow[]
  /** The last twelve months of this pot, oldest first. */
  history: LenderMonth[]
  /**
   * Principal of theirs on loans DATED TO START AFTER TODAY.
   *
   * `position.outOnLoan` counts a loan from the moment it is recorded; the
   * chart counts it from its start date. This is the difference between the
   * two, and it is surfaced rather than reconciled away — the screen has to be
   * able to say why the last column is shorter than the tile above it.
   */
  notYetStarted: Centavos
  /**
   * The Admin's cut, itemised — EMPTY FOR EVERY LENDER BUT THE ADMIN POT.
   *
   * `running` and `settled` are the same two sums as `position.adminCutPending`
   * and `position.adminCutEarned`, split loan by loan instead of totalled. That
   * is the whole reason they exist: the tiles above carry a cut that belongs to
   * none of the loans listed on this page, because it was charged on other
   * people's capital.
   *
   * Rows where the cut is zero are left out. Those are the Admin's own funding
   * rows, where there is nobody to take a cut from — and on a fixed-amount loan
   * where the Admin kept nothing. Neither adds a centavo to either total, so
   * leaving them out cannot change what the lists add up to.
   */
  adminCuts: { running: AdminCutRow[]; settled: AdminCutRow[] }
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
      where: { userId, deletedAt: null },
      _sum: { amountCentavos: true },
    }),
    db.loanFunding.findMany({
      where: { userId, loan: { deletedAt: null } },
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

const MONTH_LABEL = new Intl.DateTimeFormat('en-PH', { month: 'short' })

/** The last day of the month `back` months before the one `today` falls in. */
function monthEnd(today: Date, back: number): Date {
  return new Date(today.getFullYear(), today.getMonth() - back + 1, 0, 23, 59, 59, 999)
}

/**
 * Twelve months of one pot: what was working each month, and what was idle.
 *
 * Each column is the pot AS IT STOOD at the end of that month, rebuilt from the
 * movements rather than read from anywhere. The same sum as lib/money/floating.ts,
 * with "so far" on every term:
 *
 *   pot at M   = deposits by M - withdrawals by M + earnings realised by M
 *   out at M   = principal in loans that had started by M and were not yet repaid
 *   floating   = the rest
 *
 * Floating CAN come out negative, and the chart is built to show that rather
 * than hide it: it means more was lent out than the pot ever held.
 *
 * REPAID means a live Payment row dated on or before the month end. A payment
 * that was undone is archived and its loan put back to ACTIVE, so reading the
 * payment rather than the status is the same answer, said in a way that also
 * works for a month that ended before the payment arrived.
 *
 * The admin's pot earns one thing nobody else does — their cut on other people's
 * principal — so for isSelf every funding row is counted for its cut, and only
 * their own rows for principal and earnings. That is the rule in `ledgers`, said
 * again over time.
 */
function buildHistory(
  isSelf: boolean,
  rows: {
    lenderId: string
    principalCentavos: number
    earningsCentavos: number
    adminCutCentavos: number
    loan: { startOn: Date; paidOn: Date | null }
  }[],
  moves: { type: 'DEPOSIT' | 'WITHDRAWAL'; amountCentavos: number; occurredOn: Date }[],
  lenderId: string,
  today: Date = new Date(),
): LenderMonth[] {
  const months: LenderMonth[] = []

  for (let back = 11; back >= 0; back -= 1) {
    // THE LAST COLUMN IS TODAY, not the end of this month. A month that has not
    // happened yet would quietly include a loan dated later this month, and the
    // column meant to agree with the figures above it would be higher than
    // them for no visible reason.
    const end = back === 0 ? today : monthEnd(today, back)
    let pot = 0
    let out = 0

    for (const move of moves) {
      if (move.occurredOn > end) continue
      pot += move.type === 'DEPOSIT' ? move.amountCentavos : -move.amountCentavos
    }

    for (const row of rows) {
      const mine = row.lenderId === lenderId
      const started = row.loan.startOn <= end
      const repaid = row.loan.paidOn !== null && row.loan.paidOn <= end

      if (isSelf && repaid) pot += row.adminCutCentavos
      if (!mine || !started) continue
      if (repaid) pot += row.earningsCentavos
      else out += row.principalCentavos
    }

    months.push({
      label: MONTH_LABEL.format(end),
      outOnLoan: centavos(out),
      floating: centavos(pot - out),
    })
  }

  return months
}

/**
 * The cut rows, split the way the two tiles above them are split.
 *
 * SETTLED MEANS THE LOAN IS PAID, and nothing else. That is the very test
 * `ledgers` applies to decide between settledAdminCuts and pendingAdminCuts, so
 * `settled` here sums to position.adminCutEarned and `running` to
 * position.adminCutPending — exactly, always, because they are the same rows
 * added up the same way. `state` is 'paid' when and only when the status is
 * PAID (see loanState), which is why it can stand in for the status here.
 *
 * Running loans read soonest due first, which is the order the query asked for
 * and the order the rest of this page uses. Settled ones are reversed, newest
 * repayment on top, because a history is read from the end.
 */
function splitCuts(rows: AdminCutRow[]): { running: AdminCutRow[]; settled: AdminCutRow[] } {
  return {
    running: rows.filter((row) => row.state !== 'paid'),
    settled: rows
      .filter((row) => row.state === 'paid')
      .sort((a, b) => (b.paidOn?.getTime() ?? 0) - (a.paidOn?.getTime() ?? 0)),
  }
}

/** Everyone whose money is in play, the admin's own pot first. */
export async function listLenders(userId: string): Promise<LenderSummary[]> {
  const [lenders, byLender] = await Promise.all([
    db.lender.findMany({
      where: { userId, deletedAt: null },
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
 * Just the names, for a picker. See the borrower twin for why it is not paged.
 *
 * `listLenders` runs `ledgers()`, which reads every funding row and every
 * transaction in the account to work out each pot. The reports dropdown needs
 * none of that — it needs a name and whether this is the Admin.
 */
export async function listLenderNames(
  userId: string,
): Promise<{ id: string; firstName: string; lastName: string; isSelf: boolean }[]> {
  return db.lender.findMany({
    where: { userId, deletedAt: null },
    orderBy: [{ isSelf: 'desc' }, { firstName: 'asc' }, { lastName: 'asc' }],
    select: { id: true, firstName: true, lastName: true, isSelf: true },
  })
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

  // The chart needs every funding row when this IS the admin, because their pot
  // earns a cut on money that is not theirs. For anyone else the two queries
  // would return the same rows, so there is only ever one.
  const historyWhere = lender.isSelf ? { userId, loan: { deletedAt: null } } : { userId, lenderId, loan: { deletedAt: null } }

  const [byLender, fundings, transactions, historyRows, cutRows] = await Promise.all([
    ledgers(userId),
    db.loanFunding.findMany({
      where: { userId, lenderId, loan: { deletedAt: null } },
      select: {
        principalCentavos: true,
        earningsCentavos: true,
        lenderRateBps: true,
        loan: {
          select: {
            id: true,
            status: true,
            dueOn: true,
            termDays: true,
            borrower: { select: { id: true, firstName: true, lastName: true } },
            payment: { select: { paidOn: true, deletedAt: true } },
          },
        },
      },
      orderBy: { loan: { dueOn: 'asc' } },
    }),
    db.lenderTransaction.findMany({
      where: { userId, lenderId, deletedAt: null },
      orderBy: [{ occurredOn: 'desc' }, { createdAt: 'desc' }],
      // The loan comes along so a withdrawal drawn against one can say which.
      // Only an advance has it; on every other row it is null.
      include: { loan: { select: { id: true, borrower: { select: { firstName: true, lastName: true } } } } },
    }),
    db.loanFunding.findMany({
      where: historyWhere,
      select: {
        lenderId: true,
        principalCentavos: true,
        earningsCentavos: true,
        adminCutCentavos: true,
        loan: {
          select: {
            startOn: true,
            payment: { select: { paidOn: true, deletedAt: true } },
          },
        },
      },
    }),
    // THE ADMIN'S CUT, LOAN BY LOAN. Every funding row in the account whose cut
    // is more than nothing — which is every row funded by somebody other than
    // the Admin — because the cut is charged on capital that is not the pot's
    // and so appears on no funding row of its own.
    //
    // Queried for the Admin pot alone. On anybody else's profile this list
    // would be somebody else's money and the two totals it reconciles against
    // are both zero, so it is not fetched at all.
    lender.isSelf
      ? db.loanFunding.findMany({
          where: { userId, loan: { deletedAt: null }, adminCutCentavos: { gt: 0 } },
          select: {
            adminCutCentavos: true,
            lender: { select: { firstName: true, lastName: true } },
            loan: {
              select: {
                id: true,
                status: true,
                dueOn: true,
                termDays: true,
                borrower: { select: { firstName: true, lastName: true } },
                payment: { select: { paidOn: true, deletedAt: true } },
              },
            },
          },
          orderBy: { loan: { dueOn: 'asc' } },
        })
      : Promise.resolve([]),
  ])

  // An undone payment is soft-deleted rather than destroyed, so it is still
  // attached to its loan and would otherwise read as money that came back.
  const settledOn = (payment: { paidOn: Date; deletedAt: Date | null } | null) =>
    payment && payment.deletedAt === null ? payment.paidOn : null

  const rows: LenderFunding[] = fundings.map((row) => ({
    loanId: row.loan.id,
    borrowerId: row.loan.borrower.id,
    borrowerName: `${row.loan.borrower.firstName} ${row.loan.borrower.lastName}`,
    principal: centavos(row.principalCentavos),
    earnings: centavos(row.earningsCentavos),
    termDays: row.loan.termDays,
    dueOn: row.loan.dueOn,
    paidOn: settledOn(row.loan.payment),
    state: loanState(row.loan.status, row.loan.dueOn),
  }))

  return {
    id: lender.id,
    firstName: lender.firstName,
    lastName: lender.lastName,
    isSelf: lender.isSelf,
    position: lenderPosition(byLender.get(lender.id) ?? EMPTY_LEDGER),
    rates: [
      ...new Set(fundings.map((row) => row.lenderRateBps).filter((bps) => bps !== null)),
    ].sort((a, b) => a - b),
    fixedAmountLoans: fundings.filter((row) => row.lenderRateBps === null).length,
    fundings: rows.filter((row) => row.state !== 'paid'),
    settled: rows.filter((row) => row.state === 'paid'),
    transactions: transactions.map((row) => ({
      id: row.id,
      type: row.type,
      amount: centavos(row.amountCentavos),
      occurredOn: row.occurredOn,
      note: row.note,
      against: row.loan
        ? {
            loanId: row.loan.id,
            borrowerName: `${row.loan.borrower.firstName} ${row.loan.borrower.lastName}`,
          }
        : null,
    })),
    adminCuts: splitCuts(
      cutRows.map((row) => ({
        loanId: row.loan.id,
        borrowerName: `${row.loan.borrower.firstName} ${row.loan.borrower.lastName}`,
        lenderName: `${row.lender.firstName} ${row.lender.lastName}`,
        cut: centavos(row.adminCutCentavos),
        termDays: row.loan.termDays,
        dueOn: row.loan.dueOn,
        paidOn: settledOn(row.loan.payment),
        state: loanState(row.loan.status, row.loan.dueOn),
      })),
    ),
    notYetStarted: centavos(
      historyRows
        .filter(
          (row) =>
            row.lenderId === lender.id &&
            settledOn(row.loan.payment) === null &&
            row.loan.startOn > new Date(),
        )
        .reduce((total, row) => total + row.principalCentavos, 0),
    ),
    history: buildHistory(
      lender.isSelf,
      historyRows.map((row) => ({
        lenderId: row.lenderId,
        principalCentavos: row.principalCentavos,
        earningsCentavos: row.earningsCentavos,
        adminCutCentavos: row.adminCutCentavos,
        loan: { startOn: row.loan.startOn, paidOn: settledOn(row.loan.payment) },
      })),
      transactions,
      lender.id,
    ),
  }
}
