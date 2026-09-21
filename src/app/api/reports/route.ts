import { isReportKind, parseReportRange, rangeParams } from '@/lib/report-range.ts'
import { getCurrentUser } from '@/server/auth/guard.ts'
import { renderReport } from '@/server/reports/document.tsx'
import { borrowerReport, lenderReport, summaryReport } from '@/server/reports/queries.ts'

/**
 * A report, as a PDF the browser saves.
 *
 * A route handler rather than a server action because the answer IS the file:
 * the admin taps Download and the browser does what it does with an attachment,
 * on a phone as well as a laptop. Nothing is sent anywhere — the app has no
 * mailer, by decision in the spec. She sends it herself.
 *
 * The kind travels as a query parameter rather than a path segment so the whole
 * form can be one plain GET form. A form cannot change its own action without
 * JavaScript, and this app works without it.
 */

/** Anyone not logged in gets the login page, not a PDF and not a stack trace. */
function unauthorized() {
  return new Response(null, { status: 302, headers: { Location: '/login' } })
}

function badRequest(why: string) {
  return new Response(why, { status: 400, headers: { 'Content-Type': 'text/plain' } })
}

/** "angel-dela-cruz-statement-2026-09-01-2026-09-21.pdf" — sortable, and safe on any filesystem. */
function fileName(title: string, subject: string | null, from: string, to: string) {
  const slug = [subject, title]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `${slug}-${from}-${to}.pdf`
}

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthorized()

  const params = new URL(request.url).searchParams
  const kind = params.get('kind') ?? ''
  if (!isReportKind(kind)) return badRequest('Unknown report.')

  const range = parseReportRange({ from: params.get('from'), to: params.get('to') })
  const id = params.get('id') ?? ''

  // The id is a request, never a permission: every query below re-checks that the
  // person belongs to this account, and answers "not found" when they do not.
  const report =
    kind === 'summary'
      ? await summaryReport(user.id, range)
      : kind === 'lender'
        ? await lenderReport(user.id, id, range)
        : await borrowerReport(user.id, id, range, { withProof: kind === 'borrower-file' })

  if (!report) return badRequest('That person is not on this account.')

  const pdf = await renderReport(report)
  const { from, to } = rangeParams(range)

  return new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(pdf.length),
      'Content-Disposition': `attachment; filename="${fileName(report.header.title, report.header.subject, from, to)}"`,
      // A report is a snapshot of a moving ledger. Serving yesterday's from a
      // cache would be worse than making it again.
      'Cache-Control': 'no-store',
    },
  })
}
