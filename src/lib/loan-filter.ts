import { type Centavos, parsePesos } from './money/centavos.ts'
import { parseCalendarDate, toDateInput } from './money/weeks.ts'

/**
 * What the admin is looking for, read out of the URL.
 *
 * The search lives in the query string rather than in component state on
 * purpose: a filtered list is then a link. It survives a reload, it can be sent
 * to yourself, and the page stays a plain server component that renders the rows
 * it was asked for — no client-side list, no second copy of the loans in the
 * browser.
 *
 * Pure, and in lib/ rather than beside the page, because a .tsx file cannot be
 * imported by `node --test`. The rules about what a search means are testable;
 * the form that collects it is not.
 */

/** The one-tap filters from the spec. They are loan states, not a second vocabulary. */
export type LoanStatusFilter = 'active' | 'overdue' | 'paid'

const STATUSES: LoanStatusFilter[] = ['active', 'overdue', 'paid']

export type LoanFilter = {
  /** Exactly what was typed, so the box can show it back. */
  query: string
  /**
   * The query read as money, when the whole of it is a number. A search for
   * "30000" means the ₱30,000 loan, not a borrower whose name contains digits.
   */
  amount: Centavos | null
  /** The query split into words, for matching names. Empty when it read as an amount. */
  terms: string[]
  /** Due on or after this day. */
  from: Date | null
  /** Due on or before this day. */
  to: Date | null
  status: LoanStatusFilter | null
}

export const NO_FILTER: LoanFilter = {
  query: '',
  amount: null,
  terms: [],
  from: null,
  to: null,
  status: null,
}

/** One value out of Next's searchParams, which hands back an array for a repeated key. */
function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? (value[0] ?? '') : (value ?? '')).trim()
}

/**
 * Read a filter out of `searchParams`.
 *
 * Anything unrecognised is dropped rather than refused — a hand-edited or stale
 * URL should show the list, not an error page. The form only ever produces
 * values this accepts.
 */
export function parseLoanFilter(
  params: Record<string, string | string[] | undefined>,
): LoanFilter {
  const query = one(params.q).slice(0, 80)
  const money = query === '' ? null : parsePesos(query)
  const amount = money?.ok ? money.value : null
  const status = one(params.status) as LoanStatusFilter
  const from = parseCalendarDate(one(params.from))
  const to = parseCalendarDate(one(params.to))

  return {
    query,
    amount,
    // A name search only. When the query is an amount there are no words to match,
    // and searching names for "30000" would return nothing anyway.
    terms: amount === null ? query.split(/\s+/).filter(Boolean) : [],
    // A range typed backwards is the same range. Correcting it beats showing an
    // empty list to someone who filled the boxes in the order they read.
    from: from && to && from > to ? to : from,
    to: from && to && from > to ? from : to,
    status: STATUSES.includes(status) ? status : null,
  }
}

/** Whether anything is actually being filtered — the empty form must not read as a search. */
export function isFiltered(filter: LoanFilter): boolean {
  return (
    filter.query !== '' || filter.from !== null || filter.to !== null || filter.status !== null
  )
}

/**
 * The filter as a query string, for links that change one part of it and keep the rest.
 *
 * `page` defaults to 1 and is left out at 1, so CHANGING the filter resets the
 * paging by simply not carrying it: tapping a chip while on page 4 of the old
 * search would otherwise land on page 4 of a shorter list, which is usually
 * empty and always confusing. Only the pager itself passes a page, because it
 * is the one caller that means to keep the search and move within it.
 */
export function loanFilterHref(
  filter: LoanFilter,
  change: Partial<LoanFilter> = {},
  page: number = 1,
): string {
  const next = { ...filter, ...change }
  const params = new URLSearchParams()
  if (next.query) params.set('q', next.query)
  if (next.from) params.set('from', toDateInput(next.from))
  if (next.to) params.set('to', toDateInput(next.to))
  if (next.status) params.set('status', next.status)
  if (page > 1) params.set('page', String(page))
  const query = params.toString()
  return query ? `/loans?${query}` : '/loans'
}
