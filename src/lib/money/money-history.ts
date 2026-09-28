import { type Centavos, centavos, formatPesos } from './centavos.ts'
import { DAYS_PER_WEEK } from './weeks.ts'
import { releasedOnFunding } from './weekly.ts'

/**
 * One pot's money, as a list of what moved it and when.
 *
 * WHY. The tiles on a lender's page say where the money is NOW — floating, out
 * on loan — and the Admin asked (2026-09-28) to see how it got there: John Ross
 * was repaid, and a few days later his floating read ₱0 because the money had
 * gone straight back out. Every line here is one of those moves, oldest to
 * newest, with the floating balance after it.
 *
 * NOTHING NEW IS COUNTED. The moves are the very terms `ledgers` sums into
 * floating (lib/money/floating.ts), each placed on the day it happened:
 *
 *   deposit                      + amount          on the day it was made
 *   withdrawal (and advance)     − amount          on the day it was made
 *   lent                         − their capital   on the loan's start date
 *   a week of interest collected + their share     on the day it was paid
 *   repaid                       + capital + what is left of their interest
 *                                                  on the day it was paid
 *   Admin cut (Admin pot only)   + the cut         when its week or loan is paid
 *
 * So the balance after the LAST line is the pot's floating today, exactly — the
 * test file proves it against `lenderPosition`. A move dated in the future (a
 * loan recorded to start next week) sits at its own date, which is why the list
 * is sorted by date rather than by when it was typed.
 *
 * "Repaid" follows the loan's STATUS, the same test `ledgers` uses, so an undone
 * payment reads as a loan still out here as everywhere else.
 */

export type HistoryFunding = {
  loanId: string
  /** Whose capital this row is. */
  lenderId: string
  lenderName: string
  borrowerName: string
  principal: Centavos
  earnings: Centavos
  adminCut: Centavos
  /** Calendar days, already read out of their `date` columns. */
  startOn: Date
  /** The settling payment's day, when the loan is PAID. */
  paidOn: Date | null
  paid: boolean
  termDays: number
  weekly: boolean
  /** Weeks of interest collected, with the day each was paid. */
  weeksPaid: { week: number; paidOn: Date }[]
}

export type HistoryMove = {
  id: string
  type: 'DEPOSIT' | 'WITHDRAWAL'
  amount: Centavos
  occurredOn: Date
  note: string | null
  /** Set when a withdrawal was an advance against a loan. */
  against: { loanId: string; borrowerName: string } | null
}

export type MoneyEvent = {
  key: string
  on: Date
  kind: 'deposit' | 'withdrawal' | 'lent' | 'interest' | 'repaid' | 'cut'
  title: string
  /** A second line: whose money a cut came from, how a repayment splits. */
  detail: string | null
  /** Signed: money in is positive, money out negative. */
  amount: Centavos
  /** Floating after this move. */
  balance: Centavos
  loanId: string | null
  /** The deposit or withdrawal behind the line, so it can still be edited. */
  move: HistoryMove | null
}

type Draft = Omit<MoneyEvent, 'balance'>

const slice = (amount: Centavos, row: HistoryFunding, week: number): Centavos =>
  releasedOnFunding({ earnings: amount, adminCut: centavos(0) }, row.termDays / DAYS_PER_WEEK, new Set([week]))
    .earnings

/** What the collected weeks have already released, so a repayment adds only the rest. */
const releasedSoFar = (amount: Centavos, row: HistoryFunding): Centavos =>
  releasedOnFunding(
    { earnings: amount, adminCut: centavos(0) },
    row.termDays / DAYS_PER_WEEK,
    new Set(row.weeksPaid.map((week) => week.week)),
  ).earnings

/**
 * Every move of this pot's floating money, NEWEST FIRST, each with the balance
 * it left behind.
 *
 * `fundings` is this lender's own rows and, on the Admin pot, everybody's —
 * the cut is charged on other people's capital.
 */
export function moneyHistory(
  lenderId: string,
  isSelf: boolean,
  fundings: HistoryFunding[],
  moves: HistoryMove[],
): MoneyEvent[] {
  const drafts: Draft[] = []
  const peso = (amount: number) => centavos(amount)

  for (const move of moves) {
    const deposit = move.type === 'DEPOSIT'
    drafts.push({
      key: `move-${move.id}`,
      on: move.occurredOn,
      kind: deposit ? 'deposit' : 'withdrawal',
      title: deposit
        ? 'Money in'
        : move.against
          ? `Advance on ${move.against.borrowerName}’s loan`
          : 'Money out',
      detail: move.note,
      amount: peso(deposit ? move.amount : -move.amount),
      loanId: move.against?.loanId ?? null,
      move,
    })
  }

  for (const row of fundings) {
    const mine = row.lenderId === lenderId
    const weekly = row.weekly && Number.isInteger(row.termDays / DAYS_PER_WEEK)

    if (mine) {
      drafts.push({
        key: `lent-${row.loanId}`,
        on: row.startOn,
        kind: 'lent',
        title: `Lent to ${row.borrowerName}`,
        detail: null,
        amount: peso(-row.principal),
        loanId: row.loanId,
        move: null,
      })
    }

    if (weekly) {
      // One line per week NUMBER. `ledgers` counts a set of weeks, so a week
      // recorded twice is still one week's money there, and must be here.
      const seen = new Set<number>()
      const weeks = [...row.weeksPaid]
        .sort((a, b) => a.paidOn.getTime() - b.paidOn.getTime())
        .filter((week) => !seen.has(week.week) && seen.add(week.week))
      for (const week of weeks) {
        const own = mine ? slice(row.earnings, row, week.week) : 0
        const cut = isSelf ? slice(row.adminCut, row, week.week) : 0
        if (own > 0) {
          drafts.push({
            key: `week-${row.loanId}-${row.lenderId}-${week.week}`,
            on: week.paidOn,
            kind: 'interest',
            title: `${row.borrowerName} paid week ${week.week}`,
            detail: 'Interest collected weekly',
            amount: peso(own),
            loanId: row.loanId,
            move: null,
          })
        }
        if (cut > 0) {
          drafts.push({
            key: `weekcut-${row.loanId}-${row.lenderId}-${week.week}`,
            on: week.paidOn,
            kind: 'cut',
            title: `Admin cut · ${row.borrowerName} week ${week.week}`,
            detail: `On ${row.lenderName}’s money`,
            amount: peso(cut),
            loanId: row.loanId,
            move: null,
          })
        }
      }
    }

    if (!row.paid) continue
    const on = row.paidOn ?? row.startOn

    if (mine) {
      const interest = peso(row.earnings - (weekly ? releasedSoFar(row.earnings, row) : 0))
      drafts.push({
        key: `repaid-${row.loanId}`,
        on,
        kind: 'repaid',
        title: `${row.borrowerName} paid back`,
        detail:
          interest > 0
            ? `${formatPesos(row.principal)} capital + ${formatPesos(interest)} interest`
            : `${formatPesos(row.principal)} capital`,
        amount: peso(row.principal + interest),
        loanId: row.loanId,
        move: null,
      })
    }

    const cut = isSelf ? peso(row.adminCut - (weekly ? releasedSoFar(row.adminCut, row) : 0)) : 0
    if (cut > 0) {
      drafts.push({
        key: `cut-${row.loanId}-${row.lenderId}`,
        on,
        kind: 'cut',
        title: `Admin cut · ${row.borrowerName}`,
        detail: `On ${row.lenderName}’s money`,
        amount: peso(cut),
        loanId: row.loanId,
        move: null,
      })
    }
  }

  // Oldest first to run the balance. On one day, money in is counted before
  // money out: a repayment that arrives in the morning and is lent again that
  // afternoon should not show the pot dipping below zero in between.
  const ordered = drafts
    .map((draft, index) => ({ draft, index }))
    .sort(
      (a, b) =>
        a.draft.on.getTime() - b.draft.on.getTime() ||
        Number(a.draft.amount < 0) - Number(b.draft.amount < 0) ||
        a.index - b.index,
    )

  let balance = 0
  const events = ordered.map(({ draft }) => {
    balance += draft.amount
    return { ...draft, balance: centavos(balance) }
  })

  return events.reverse()
}
