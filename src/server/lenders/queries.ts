import { type Centavos, centavos } from '../../lib/money/centavos.ts'
import { type InterestCollection } from '../../lib/money/interest.ts'
import { type ReportRange, defaultRange } from '../../lib/report-range.ts'
import { accruedBetween } from '../../lib/money/accrual.ts'
import { DAYS_PER_WEEK, storedCalendarDate } from '../../lib/money/weeks.ts'
import { releasedOnFunding } from '../../lib/money/weekly.ts'
import { type LenderLedger, type LenderPosition, EMPTY_LEDGER, lenderPosition } from '../../lib/money/floating.ts'
import { type LoanState, storedLoanState } from '../../lib/loan-state.ts'
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
type HistoryRow = {
  lenderId: string
  principalCentavos: number
  earningsCentavos: number
  adminCutCentavos: number
  loan: {
    startOn: Date
    paidOn: Date | null
    termDays: number
    interestCollection: InterestCollection
    /** The week numbers collected, with the day each was handed over. */
    weeksPaid: { week: number; paidOn: Date }[]
  }
}

/**
 * What a weekly loan's funding row had released by a given day.
 *
 * The weeks collected ON OR BEFORE that day, which is the same rule
 * releasedOnRow uses for today, applied to a month end. A week collected later
 * this year must not appear in March's column.
 */
function releasedByDate(row: HistoryRow, end: Date): { earnings: number; adminCut: number } {
  if (row.loan.interestCollection !== 'WEEKLY') return { earnings: 0, adminCut: 0 }

  const byThen = new Set(row.loan.weeksPaid.filter((week) => week.paidOn <= end).map((week) => week.week))

  return releasedOnFunding(
    { earnings: centavos(row.earningsCentavos), adminCut: centavos(row.adminCutCentavos) },
    row.loan.termDays / DAYS_PER_WEEK,
    byThen,
  )
}

function buildHistory(
  isSelf: boolean,
  rows: HistoryRow[],
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

      // Weeks collected BY the end of this month. A weekly loan drips into the
      // pot month after month while its capital stays in `out` — which is the
      // shape this chart exists to show.
      const weeklyByThen = releasedByDate(row, end)

      if (isSelf) pot += repaid ? row.adminCutCentavos : weeklyByThen.adminCut
      if (!mine || !started) continue
      if (repaid) pot += row.earningsCentavos
      else {
        pot += weeklyByThen.earnings
        out += row.principalCentavos
      }
    }

    months.push({
      label: MONTH_LABEL.format(end),
      outOnLoan: centavos(out),
      floating: centavos(pot - out),
    })
  }

  return months
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
  return centavos(
    rows.reduce((total, row) => {
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

      const own = row.lenderId === lenderId ? accrued(row.earningsCentavos) : 0
      const cut = isSelf ? accrued(row.adminCutCentavos) : 0
      return total + own + cut
    }, 0),
  )
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
            nextDueOn: true,
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
        loan: {
          select: {
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
                dueOn: true,
                nextDueOn: true,
                termDays: true,
                borrower: { select: { firstName: true, lastName: true } },
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
    state: storedLoanState(row.loan.status, row.loan.nextDueOn),
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
        paidOn: settledOn(row.loan.payments),
        state: storedLoanState(row.loan.status, row.loan.nextDueOn),
      })),
    ),
    notYetStarted: centavos(
      historyRows
        .filter(
          (row) =>
            row.lenderId === lender.id &&
            settledOn(row.loan.payments) === null &&
            row.loan.startOn > new Date(),
        )
        .reduce((total, row) => total + row.principalCentavos, 0),
    ),
    range,
    /* SAME ROWS THE CHART IS BUILT FROM, which is why no extra query was
       needed: `historyRows` is already every live funding row this figure can
       draw on — this lender's own, plus everyone else's on the Admin pot, where
       the cut lives. `startOn` and `termDays` are the only two columns the
       spread reads. */
    rangeInterest: interestAccruedIn(lender.isSelf, lender.id, historyRows, range),
    history: buildHistory(
      lender.isSelf,
      historyRows.map((row) => ({
        lenderId: row.lenderId,
        principalCentavos: row.principalCentavos,
        earningsCentavos: row.earningsCentavos,
        adminCutCentavos: row.adminCutCentavos,
        loan: {
          startOn: row.loan.startOn,
          paidOn: settledOn(row.loan.payments),
          termDays: row.loan.termDays,
          interestCollection: row.loan.interestCollection,
          weeksPaid: liveWeeklyPayments(row.loan.payments).map((payment) => ({
            week: payment.weekNumber as number,
            paidOn: payment.paidOn,
          })),
        },
      })),
      transactions,
      lender.id,
    ),
  }
}
