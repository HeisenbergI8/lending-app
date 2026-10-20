import { type Centavos, centavos } from '../../lib/money/centavos.ts'
import { type InterestCollection } from '../../lib/money/interest.ts'
import { type ReportRange, defaultRange } from '../../lib/report-range.ts'
import { accruedBetween } from '../../lib/money/accrual.ts'
import { DAYS_PER_WEEK, calendarDate, storedCalendarDate } from '../../lib/money/weeks.ts'
import { type Projection, projectFloating } from '../../lib/money/projection.ts'
import { releasedOnFunding } from '../../lib/money/weekly.ts'
import { type LenderLedger, type LenderPosition, EMPTY_LEDGER, lenderPosition } from '../../lib/money/floating.ts'
import { type LoanState, storedLoanStateWithReminder } from '../../lib/loan-state.ts'
import { type MoneyEvent, moneyHistory } from '../../lib/money/money-history.ts'
import { db } from '../db.ts'
import { SETTLING, liveWeeklyPayments, settledOn } from '../payments/settled.ts'

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
  /**
   * What this person put in to START, as the Admin typed it
   * (Lender.startingCapitalCentavos).
   *
   * It is deliberately not part of `position`: it is typed, not derived, and it
   * is in no floating figure. Zero means the Admin has not said yet — see the
   * schema comment.
   */
  startingCapital: Centavos
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
  /** The "Remind me" day, when that is what makes `state` due-soon. See LoanRow.reminderOn. */
  reminderOn: Date | null
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

/** One saved value of the starting capital, with the note on why it changed. */
export type CapitalVersion = {
  id: string
  amount: Centavos
  note: string | null
  savedAt: Date
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
  borrowerId: string
  borrowerName: string
  /** Whose capital the cut was taken on. Never the Admin's own: that row's cut is zero. */
  lenderName: string
  cut: Centavos
  /** How long the loan runs, start to due. Days for every loan; said in weeks. */
  termDays: number
  dueOn: Date
  paidOn: Date | null
  state: LoanState
  /** The "Remind me" day, when that is what makes `state` due-soon. See LoanRow.reminderOn. */
  reminderOn: Date | null
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
  /** Every saved value of the starting capital, newest first. The newest is `startingCapital`. */
  capitalVersions: CapitalVersion[]
  /**
   * Every move of this pot's floating money, newest first, with the balance
   * after each — see lib/money/money-history.ts. The balance on the newest line
   * is `position.floating`.
   */
  moneyHistory: MoneyEvent[]
  /**
   * Interest this pot EARNED over `range`, spread across the days each loan ran.
   *
   * Not cash and not a position — see interestAccruedIn. It exists so the lender
   * can ask "what did my money make in September" and get an answer that a loan
   * straddling August and October cannot distort in either direction.
   */
  rangeInterest: Centavos
  /** The stretch of time `rangeInterest` covers. This month so far, unless asked otherwise. */
  range: ReportRange
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
  const [transactions, fundings, self, weeksPaid] = await Promise.all([
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
        loan: { select: { id: true, status: true, termDays: true, interestCollection: true } },
      },
    }),
    db.lender.findFirst({ where: { userId, isSelf: true }, select: { id: true } }),
    // WHICH WEEKS HAVE BEEN COLLECTED, for every weekly loan on the account, in
    // one query. Not one per loan and not a join: an account has a handful of
    // weekly loans carrying twenty rows each, so this is tens of rows, and
    // fetching the week NUMBERS rather than a count lets the caller decide what
    // a gap means instead of having Postgres guess.
    db.payment.findMany({
      where: {
        userId,
        deletedAt: null,
        weekNumber: { not: null },
        loan: { deletedAt: null, interestCollection: 'WEEKLY' },
      },
      select: { loanId: true, weekNumber: true },
    }),
  ])

  const paidByLoan = new Map<string, Set<number>>()
  for (const row of weeksPaid) {
    if (row.weekNumber === null) continue
    const weeks = paidByLoan.get(row.loanId) ?? new Set<number>()
    weeks.add(row.weekNumber)
    paidByLoan.set(row.loanId, weeks)
  }

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

    // A WEEKLY LOAN IS SETTLED AND PENDING AT THE SAME TIME, and that is the
    // whole feature. FEATURES.md section 5: a paid week releases that week's
    // money immediately, while the capital stays out on loan until February.
    //
    // So the row is split three ways rather than two. The capital is out until
    // the loan is PAID, exactly as before. The earnings are divided at the line
    // between weeks collected and weeks still owed, which realisedThrough
    // answers from the loan's own stored figures — no rate, no recomputation.
    //
    // On a loan collected at the end this is zero while it runs, so those loans
    // go down the same two paths they always did and no branch below has to ask
    // which kind of loan it is looking at.
    const released = releasedOnRow(row, paidByLoan)

    if (settled) entry.settledEarnings = centavos(entry.settledEarnings + row.earningsCentavos)
    else {
      entry.activePrincipal = centavos(entry.activePrincipal + row.principalCentavos)
      entry.settledEarnings = centavos(entry.settledEarnings + released.earnings)
      entry.pendingEarnings = centavos(entry.pendingEarnings + row.earningsCentavos - released.earnings)
    }

    // The cut on this row is the ADMIN's, wherever the principal came from. On a
    // row the admin funded themselves it is zero, so this needs no branch.
    if (self) {
      const admin = ledger(self.id)
      if (settled) admin.settledAdminCuts = centavos(admin.settledAdminCuts + row.adminCutCentavos)
      else {
        // The Admin's cut follows the same line, week for week. It reaches Admin
        // earnings the day the week is collected, not when the loan settles —
        // the other half of the same sentence in the spec.
        admin.settledAdminCuts = centavos(admin.settledAdminCuts + released.adminCut)
        admin.pendingAdminCuts = centavos(
          admin.pendingAdminCuts + row.adminCutCentavos - released.adminCut,
        )
      }
    }
  }

  return byLender
}

type ReleasableRow = {
  earningsCentavos: number
  adminCutCentavos: number
  loan: { id: string; termDays: number; interestCollection: InterestCollection }
}

/**
 * What of this funding row has actually reached its owner.
 *
 * Zero on a loan collected at the end, and on a weekly loan with no week
 * collected yet. Never more than the row's stored figures, whatever the payments
 * say, because the stored figures are what was agreed.
 *
 * Both halves come back together because both are decided by the same week
 * count. Working them out separately would be two places to get the division by
 * DAYS_PER_WEEK wrong.
 */
function releasedOnRow(
  row: ReleasableRow,
  paidByLoan: Map<string, Set<number>>,
): { earnings: Centavos; adminCut: Centavos } {
  if (row.loan.interestCollection !== 'WEEKLY') return { earnings: centavos(0), adminCut: centavos(0) }

  return releasedOnFunding(
    { earnings: centavos(row.earningsCentavos), adminCut: centavos(row.adminCutCentavos) },
    row.loan.termDays / DAYS_PER_WEEK,
    paidByLoan.get(row.loan.id) ?? new Set(),
  )
}

/** One funding row, as much of it as the accrual needs. */
type AccrualRow = {
  lenderId: string
  earningsCentavos: number
  adminCutCentavos: number
  loan: { startOn: Date; termDays: number }
}

/**
 * What this pot earned over a stretch of time, spread across the days each loan ran.
 *
 * THE ONE FIGURE ON THIS SCREEN THAT IS NOT ABOUT CASH. Everything else in this
 * file answers "how much has reached this pot" — decided by which weeks were
 * collected and which loans were repaid. This answers "how much did this pot
 * earn in September", so a loan running August to October counts in all three
 * months whatever month the money actually arrived in. See lib/money/accrual.ts
 * for why, and for the exactness the spread guarantees.
 *
 * WHOSE MONEY, said the same way `ledgers` and `buildHistory` say it: this
 * lender's own funding rows for their earnings, plus — on the Admin pot ONLY —
 * the cut charged on every other funder's row, because that cut is the Admin's
 * income and sits on no funding row of their own. On anybody else both cut
 * figures are zero, so the branch changes nothing for them.
 *
 * SCOPE, in full: live funding rows (`Loan.deletedAt IS NULL`) belonging to this
 * user, at the stored `earningsCentavos` and `adminCutCentavos` — never
 * recomputed from a rate. A loan's status is NOT consulted and must not be: a
 * repaid loan earned what it earned in the months it ran, and dropping it would
 * make last month's figure shrink every time a borrower pays. A loan dated to
 * start in the future contributes nothing, because accruedBetween clamps at the
 * start date.
 *
 * NOT RECONCILABLE AGAINST `position.earned` OR `position.pending`, by design.
 * Those two split the same interest at the line between collected and not; this
 * splits it by date. Over a range covering every loan's whole term all three
 * meet at the same total, and over any shorter range they do not. The tile says
 * so on screen.
 */
function interestAccruedIn(
  isSelf: boolean,
  lenderId: string,
  rows: AccrualRow[],
  range: ReportRange,
): Centavos {
  let own = 0
  let cut = 0
  for (const row of rows) {
    /* THE START DATE IS NORMALISED ON THE WAY IN, and it has to be here rather
       than inside accruedBetween. `row.loan.startOn` is a Postgres `date`, so
       the driver hands it back as midnight UTC, and reading its calendar day
       with the local parts gives the day BEFORE under any negative UTC offset.
       Unfixed, this figure changed by a hundred pesos on the same rows purely
       because the server's TZ was America/New_York rather than UTC.

       accruedBetween cannot do it: `range.from` and `range.to` are local
       MIDDAY dates from parseCalendarDate, and the two conventions need
       opposite corrections. The boundary is where the origin of each date is
       still known. See storedCalendarDate. */
    const startOn = storedCalendarDate(row.loan.startOn)

    const accrued = (amount: number) =>
      accruedBetween(centavos(amount), startOn, row.loan.termDays, range.from, range.to)

    if (row.lenderId === lenderId) own += accrued(row.earningsCentavos)
    if (isSelf) cut += accrued(row.adminCutCentavos)
  }
  return centavos(own + cut)
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
  // SETTLED STILL MEANS THE LOAN IS PAID, including for a weekly loan with
  // nineteen of its twenty weeks collected. Its capital is still out, so the row
  // belongs under running, which is what that list means.
  //
  // The consequence is deliberate and is NOT a bug to fix here: the two lists
  // reconcile against position.adminCutEarned and position.adminCutPending, and
  // those two are now split at the WEEK line rather than the loan line. So a
  // running weekly loan's cut appears in both tiles while its row appears once,
  // under running, showing the whole loan's cut. The row says what the loan will
  // pay; the tiles say what has arrived. The loan page is where the week by week
  // breakdown lives, and the screen prints the difference rather than hiding it
  // — the same thing LenderDetail.adminCuts already exists to do.
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
    startingCapital: centavos(lender.startingCapitalCentavos),
    position: lenderPosition(byLender.get(lender.id) ?? EMPTY_LEDGER),
  }))
}

/**
 * Every lender's floating funds, by id — the same figure the lenders list shows,
 * from the same ledgers, for the one question a new loan asks: is the money there?
 */
export async function floatingByLender(userId: string): Promise<Map<string, Centavos>> {
  const byLender = await ledgers(userId)
  return new Map([...byLender].map(([id, ledger]) => [id, lenderPosition(ledger).floating]))
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
 *
 * `range` is for the earned-over-a-period figure alone. Every other figure here
 * is a fact about today and is NEVER ranged, for the reason report-range.ts
 * states: the ledger stores movements rather than nightly balances, so it cannot
 * honestly say what was floating last March. Defaults to this month so far.
 */
export async function getLender(
  userId: string,
  lenderId: string,
  range: ReportRange = defaultRange(),
): Promise<LenderDetail | null> {
  const lender = await db.lender.findFirst({
    where: { id: lenderId, userId },
    include: { capitalVersions: { orderBy: { createdAt: 'desc' } } },
  })
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
            startOn: true,
            dueOn: true,
            nextDueOn: true,
            remindEveryWeeks: true,
            termDays: true,
            borrower: { select: { id: true, firstName: true, lastName: true } },
            payments: { where: SETTLING, select: { paidOn: true, deletedAt: true, weekNumber: true } },
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
        // Names and status for the money history: who was lent to, whose
        // capital a cut came from, and whether the loan counts as repaid.
        lender: { select: { firstName: true, lastName: true } },
        loan: {
          select: {
            id: true,
            status: true,
            borrower: { select: { firstName: true, lastName: true } },
            startOn: true,
            termDays: true,
            interestCollection: true,
            // EVERY live payment, not only the settling one. A weekly loan's
            // interest arrives month after month, and the chart's whole job is
            // to show that — it cannot while every peso lands on one day.
            payments: { where: { deletedAt: null }, select: { paidOn: true, deletedAt: true, weekNumber: true } },
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
                startOn: true,
                dueOn: true,
                nextDueOn: true,
                remindEveryWeeks: true,
                termDays: true,
                borrower: { select: { id: true, firstName: true, lastName: true } },
                payments: { where: SETTLING, select: { paidOn: true, deletedAt: true, weekNumber: true } },
              },
            },
          },
          orderBy: { loan: { dueOn: 'asc' } },
        })
      : Promise.resolve([]),
  ])

  const rows: LenderFunding[] = fundings.map((row) => ({
    loanId: row.loan.id,
    borrowerId: row.loan.borrower.id,
    borrowerName: `${row.loan.borrower.firstName} ${row.loan.borrower.lastName}`,
    principal: centavos(row.principalCentavos),
    earnings: centavos(row.earningsCentavos),
    termDays: row.loan.termDays,
    dueOn: row.loan.dueOn,
    paidOn: settledOn(row.loan.payments),
    ...storedLoanStateWithReminder(row.loan),
  }))

  return {
    id: lender.id,
    firstName: lender.firstName,
    lastName: lender.lastName,
    isSelf: lender.isSelf,
    startingCapital: centavos(lender.startingCapitalCentavos),
    capitalVersions: lender.capitalVersions.map((row) => ({
      id: row.id,
      amount: centavos(row.amountCentavos),
      note: row.note,
      savedAt: row.createdAt,
    })),
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
        borrowerId: row.loan.borrower.id,
        borrowerName: `${row.loan.borrower.firstName} ${row.loan.borrower.lastName}`,
        lenderName: `${row.lender.firstName} ${row.lender.lastName}`,
        cut: centavos(row.adminCutCentavos),
        termDays: row.loan.termDays,
        dueOn: row.loan.dueOn,
        paidOn: settledOn(row.loan.payments),
        ...storedLoanStateWithReminder(row.loan),
      })),
    ),
    range,
    /* SAME ROWS THE CHART IS BUILT FROM, which is why no extra query was
       needed: `historyRows` is already every live funding row this figure can
       draw on — this lender's own, plus everyone else's on the Admin pot, where
       the cut lives. `startOn` and `termDays` are the only two columns the
       spread reads. */
    rangeInterest: interestAccruedIn(lender.isSelf, lender.id, historyRows, range),
    moneyHistory: moneyHistory(
      lender.id,
      lender.isSelf,
      historyRows.map((row) => ({
        loanId: row.loan.id,
        lenderId: row.lenderId,
        lenderName: `${row.lender.firstName} ${row.lender.lastName}`,
        borrowerName: `${row.loan.borrower.firstName} ${row.loan.borrower.lastName}`,
        principal: centavos(row.principalCentavos),
        earnings: centavos(row.earningsCentavos),
        adminCut: centavos(row.adminCutCentavos),
        // All three are `date` columns, read back at midnight UTC.
        startOn: storedCalendarDate(row.loan.startOn),
        paidOn: (() => {
          const on = settledOn(row.loan.payments)
          return on ? storedCalendarDate(on) : null
        })(),
        // STATUS, the test `ledgers` uses — so the last balance is floating.
        paid: row.loan.status === 'PAID',
        termDays: row.loan.termDays,
        weekly: row.loan.interestCollection === 'WEEKLY',
        weeksPaid: liveWeeklyPayments(row.loan.payments).map((payment) => ({
          week: payment.weekNumber as number,
          paidOn: storedCalendarDate(payment.paidOn),
        })),
      })),
      transactions.map((row) => ({
        id: row.id,
        type: row.type,
        amount: centavos(row.amountCentavos),
        occurredOn: storedCalendarDate(row.occurredOn),
        note: row.note,
        against: row.loan
          ? { loanId: row.loan.id, borrowerName: `${row.loan.borrower.firstName} ${row.loan.borrower.lastName}` }
          : null,
      })),
    ),
  }
}

/**
 * This pot's floating funds on `on`, if every borrower pays on time — the
 * "Available on" check on a lender's page. The arithmetic and what it assumes
 * are in lib/money/projection.ts; this fetches the rows.
 *
 * ROWS: every funding row of this lender on a loan that is unpaid (ACTIVE) and
 * not deleted, and — for the Admin pot only — every row on such a loan that
 * carries an Admin cut, whoever funded it, because the cut is the Admin's.
 * Weeks count as paid only on a live payment (an undone one is archived).
 *
 * `floatingNow` is passed in, not recomputed: it is the page's own Floating
 * figure, so the projection starts from exactly the number on the screen.
 */
export async function projectedFloating(
  userId: string,
  lender: { id: string; isSelf: boolean },
  floatingNow: Centavos,
  on: Date,
): Promise<Projection> {
  const unpaid = { deletedAt: null, status: 'ACTIVE' as const }
  const funding = await db.loanFunding.findMany({
    where: {
      userId,
      loan: unpaid,
      OR: [{ lenderId: lender.id }, ...(lender.isSelf ? [{ adminCutCentavos: { gt: 0 } }] : [])],
    },
    select: {
      lenderId: true,
      principalCentavos: true,
      earningsCentavos: true,
      adminCutCentavos: true,
      loan: {
        select: {
          id: true,
          interestCollection: true,
          startOn: true,
          dueOn: true,
          termDays: true,
          borrower: { select: { firstName: true, lastName: true } },
          payments: { where: { deletedAt: null, weekNumber: { not: null } }, select: { weekNumber: true } },
        },
      },
    },
  })

  return projectFloating(
    floatingNow,
    funding.map((row) => {
      const own = row.lenderId === lender.id
      return {
        loanId: row.loan.id,
        borrowerName: `${row.loan.borrower.firstName} ${row.loan.borrower.lastName}`,
        interestCollection: row.loan.interestCollection,
        startOn: storedCalendarDate(row.loan.startOn),
        dueOn: storedCalendarDate(row.loan.dueOn),
        termDays: row.loan.termDays,
        principal: centavos(own ? row.principalCentavos : 0),
        earnings: centavos(own ? row.earningsCentavos : 0),
        // Zero on the Admin's own rows by the schema, and never this pot's
        // unless this pot is the Admin's.
        adminCut: centavos(lender.isSelf ? row.adminCutCentavos : 0),
        paidWeeks: new Set(row.loan.payments.flatMap((p) => (p.weekNumber === null ? [] : [p.weekNumber]))),
      }
    }),
    calendarDate(new Date()),
    on,
  )
}
