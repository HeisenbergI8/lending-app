import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import { PAGE_SIZE, pageCount, pageRange } from '@/lib/pagination.ts'
import { cn } from '@/lib/utils'

/**
 * Previous / next across a paged list.
 *
 * Plain links, no client component: the page number lives in the URL, so paging
 * is a navigation rather than state, it works with no JavaScript, and this file
 * stays out of the browser bundle. Same reasoning as the loan search chips.
 *
 * `href` builds the URL for a page and is the caller's job, because only the
 * caller knows what else is in the query string. On the loans list that is the
 * whole search — paging must not quietly drop the filter you are paging through.
 *
 * "21-40 of 87" is not decoration. A paged list is a capped list, and the
 * label-truth rule is that a cap is printed rather than left in the code: this
 * is the line that stops the rows on screen being read as all of them.
 */
export function Pager({
  page,
  total,
  href,
  size = PAGE_SIZE,
  noun = 'rows',
}: {
  page: number
  /** Across the whole filter, not the length of what is rendered. */
  total: number
  href: (page: number) => string
  size?: number
  /** Plural, for the count line — "of 87 loans". */
  noun?: string
}) {
  const pages = pageCount(total, size)
  // One page needs no controls, and the heading above already says how many
  // there are. Showing a dead "Page 1 of 1" on every short list is noise.
  if (pages <= 1) return null

  const { first, last } = pageRange(page, total, size)

  return (
    <nav
      aria-label="Pages"
      className="border-border/70 flex flex-wrap items-center justify-between gap-3 border-t pt-4"
    >
      <p className="text-muted-foreground text-xs" aria-live="polite">
        {first}&ndash;{last} of {total} {noun} · page {page} of {pages}
      </p>

      <div className="flex items-center gap-2">
        <Step href={href(page - 1)} disabled={page <= 1} rel="prev" label="Previous page">
          <ChevronLeft className="size-4" aria-hidden />
          Previous
        </Step>
        <Step href={href(page + 1)} disabled={page >= pages} rel="next" label="Next page">
          Next
          <ChevronRight className="size-4" aria-hidden />
        </Step>
      </div>
    </nav>
  )
}

/**
 * One step. At the ends it becomes a span rather than a dead link: a disabled
 * anchor still takes focus and still looks tappable, which on a phone is a
 * button that does nothing.
 */
function Step({
  href,
  disabled,
  rel,
  label,
  children,
}: {
  href: string
  disabled: boolean
  rel: 'prev' | 'next'
  label: string
  children: React.ReactNode
}) {
  const shape =
    'inline-flex min-h-11 items-center gap-1 rounded-full border px-3 text-xs font-medium transition-colors pointer-fine:min-h-0 pointer-fine:py-1.5'

  if (disabled) {
    return (
      <span aria-disabled className={cn(shape, 'border-border/60 text-muted-foreground/50')}>
        {children}
      </span>
    )
  }

  return (
    <Link href={href} rel={rel} aria-label={label} className={cn(shape, 'border-border hover:bg-muted hover:border-brand-line')}>
      {children}
    </Link>
  )
}
