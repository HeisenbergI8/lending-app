import { toDateInput } from '@/lib/money/weeks.ts'
import { getCurrentUser } from '@/server/auth/guard.ts'
import { loanBackup } from '@/server/reports/backup.ts'

/**
 * The loan book as an Excel file the browser saves.
 *
 * A sibling of ../route.ts and deliberately not a `kind` on it: that route
 * renders PDFs over a period and can preview them inline, and this is one
 * spreadsheet of everything with nothing to preview. Folding them together
 * would mean a content type and a date range that each apply to half the cases.
 *
 * No period parameter at all. The card sends none and this reads none, so a
 * stale link or a typed URL cannot quietly produce a partial backup.
 */

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return new Response(null, { status: 302, headers: { Location: '/login' } })

  const now = new Date()
  const book = await loanBackup(user.id, now)

  return new Response(new Uint8Array(book), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Length': String(book.length),
      // Dated, so twelve monthly downloads sit in one folder in order rather
      // than as "loan-book (11).xlsx".
      'Content-Disposition': `attachment; filename="loan-book-${toDateInput(now)}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  })
}
