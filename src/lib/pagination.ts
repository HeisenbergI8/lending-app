/**
 * Paging a list, read out of the URL.
 *
 * Like the loan search, the page number lives in the query string rather than in
 * component state: page 3 of a filtered list is then a link that survives a
 * reload, and every list screen stays a plain server component that renders the
 * rows it was asked for.
 *
 * Pure, and in lib/ rather than beside a page, because a .tsx file cannot be
 * imported by `node --test`. The clamping rules are worth a test; the buttons
 * that trigger them are not.
 */

/**
 * Rows per page.
 *
 * Phone-first: a loan card is about 90px tall, so ten is roughly one thumb
 * scroll and one round trip. It is deliberately the same across every list —
 * a per-screen size is a number nobody can predict from the outside, and the
 * screens have no reason to differ.
 */
export const PAGE_SIZE = 10

export type PageWindow = {
  /** 1-based, because it is shown to a person. */
  page: number
  skip: number
  take: number
}

/**
 * Read `?page=` into a window.
 *
 * Anything unreadable — a word, a negative, a decimal, a hand-edited URL —
 * becomes page 1 rather than an error, for the same reason `parseLoanFilter`
 * drops what it does not recognise: a stale link should show the list.
 *
 * A page number PAST the end is deliberately NOT clamped here, because the total
 * is not known yet and finding it out would cost a second round trip before the
 * rows could even be asked for. The caller renders an empty page instead, which
 * is honest and costs nothing.
 */
export function parsePage(value: string | string[] | undefined, size: number = PAGE_SIZE): PageWindow {
  const raw = Array.isArray(value) ? (value[0] ?? '') : (value ?? '')
  const parsed = Number(raw.trim())
  const page = Number.isSafeInteger(parsed) && parsed > 1 ? parsed : 1

  return { page, skip: (page - 1) * size, take: size }
}

/** How many pages `total` rows fill. Always at least 1, so "Page 1 of 1" reads normally when empty. */
export function pageCount(total: number, size: number = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / size))
}

/**
 * The 1-based row numbers this page covers, for printing the bound next to the
 * list — "21-40 of 87". The label-truth rule wants a cap said out loud rather
 * than left in the code, and on a paged list the cap IS which rows these are.
 *
 * `last` is held down to `total` so the final page reads "81-87 of 87" rather
 * than promising rows that are not there.
 */
export function pageRange(page: number, total: number, size: number = PAGE_SIZE): { first: number; last: number } {
  if (total === 0) return { first: 0, last: 0 }

  const first = (page - 1) * size + 1
  return { first, last: Math.min(page * size, total) }
}

/**
 * Page links for a screen that holds MORE THAN ONE list.
 *
 * A lender's page has six of them, so a single `?page=` cannot serve it: paging
 * the withdrawals would silently reset the loans. Each list gets its own key,
 * and every other key in the query string is carried across untouched.
 *
 * The anchor is not decoration either. Paging the sixth list on a long page
 * would otherwise land the admin back at the top with no sign anything moved.
 */
export function pagedHref(
  path: string,
  current: Record<string, string | string[] | undefined>,
): (key: string, anchor: string) => (page: number) => string {
  return (key, anchor) => (page) => {
    const query = new URLSearchParams()

    for (const [name, value] of Object.entries(current)) {
      const first = Array.isArray(value) ? value[0] : value
      if (first && name !== key) query.set(name, first)
    }
    // Page 1 is the default, so it is left out — the URL of a list nobody has
    // paged stays clean.
    if (page > 1) query.set(key, String(page))

    const search = query.toString()
    return `${path}${search ? `?${search}` : ''}#${anchor}`
  }
}
