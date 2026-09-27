import { type Centavos, BPS_DENOMINATOR, centavos } from './money/centavos.ts'
import { DAYS_PER_WEEK } from './money/weeks.ts'

/**
 * The loan export: one short block of lines per loan, for pasting into a chat or
 * printing as a list.
 *
 *   NAME: Arianell Matel
 *   DUE: 09/22 - 10/20 (4weeks 7%)
 *   AMOUNT: 25,000
 *   INTEREST: 7,000 (Admin cut: 2,000)
 *   TOTAL: 32,000
 *
 * Pure, so the wording can be tested without a database or a Word file. Every
 * figure arrives already stored — nothing here works out interest.
 */

export const LOAN_EXPORT_SCOPES = ['overall', 'lender'] as const
export type LoanExportScope = (typeof LOAN_EXPORT_SCOPES)[number]

export const LOAN_EXPORT_STATUSES = ['active', 'paid', 'all'] as const
export type LoanExportStatus = (typeof LOAN_EXPORT_STATUSES)[number]

export function isLoanExportScope(value: string): value is LoanExportScope {
  return (LOAN_EXPORT_SCOPES as readonly string[]).includes(value)
}

export function isLoanExportStatus(value: string): value is LoanExportStatus {
  return (LOAN_EXPORT_STATUSES as readonly string[]).includes(value)
}

export type LoanExportEntry = {
  borrowerName: string
  /** Calendar dates, already read out of their `date` columns. */
  startOn: Date
  dueOn: Date
  termDays: number
  /** Null on a fixed-amount loan, where no rate was agreed. */
  borrowerRateBps: number | null
  amount: Centavos
  /** The whole interest on `amount`, Admin cut included. */
  interest: Centavos
  /** The Admin's share of `interest` on another lender's money. 0 hides it. */
  adminCut: Centavos
}

/** "25,000", or "25,000.50" when there are centavos. No peso sign, as asked. */
export function formatAmount(amount: Centavos): string {
  const negative = amount < 0
  const abs = Math.abs(amount)
  const whole = Math.floor(abs / 100).toLocaleString('en-PH')
  const fraction = abs % 100
  return `${negative ? '-' : ''}${whole}${fraction === 0 ? '' : `.${String(fraction).padStart(2, '0')}`}`
}

const monthDay = (date: Date): string =>
  `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`

/** "4weeks", "1week", or "10days" when the term is not whole weeks. */
function term(days: number): string {
  if (days % DAYS_PER_WEEK === 0) {
    const weeks = days / DAYS_PER_WEEK
    return weeks === 1 ? '1week' : `${weeks}weeks`
  }
  return days === 1 ? '1day' : `${days}days`
}

/** 700 -> "7%", 650 -> "6.5%". */
function rate(bps: number): string {
  return `${Number(((bps / BPS_DENOMINATOR) * 100).toFixed(2))}%`
}

export function loanExportLines(entry: LoanExportEntry): string[] {
  const terms = [term(entry.termDays), entry.borrowerRateBps === null ? 'fixed' : rate(entry.borrowerRateBps)]
  const cut = entry.adminCut > 0 ? ` (Admin cut: ${formatAmount(entry.adminCut)})` : ''
  return [
    `NAME: ${entry.borrowerName}`,
    `DUE: ${monthDay(entry.startOn)} - ${monthDay(entry.dueOn)} (${terms.join(' ')})`,
    `AMOUNT: ${formatAmount(entry.amount)}`,
    `INTEREST: ${formatAmount(entry.interest)}${cut}`,
    `TOTAL: ${formatAmount(centavos(entry.amount + entry.interest))}`,
  ]
}
