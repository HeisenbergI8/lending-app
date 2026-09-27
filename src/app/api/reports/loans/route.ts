import { isLoanExportScope, isLoanExportStatus } from '@/lib/loan-export.ts'
import { getCurrentUser } from '@/server/auth/guard.ts'
import { loanExport } from '@/server/reports/loan-export.ts'

/**
 * The loan list as a Word file the browser saves — overall, or one lender's.
 *
 * A sibling of ../route.ts for the same reason as ../backup: that route renders
 * PDFs over a period, and this is a different file with no period.
 */

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return new Response(null, { status: 302, headers: { Location: '/login' } })

  const params = new URL(request.url).searchParams
  const scope = params.get('scope') ?? ''
  const status = params.get('status') ?? 'active'
  if (!isLoanExportScope(scope) || !isLoanExportStatus(status)) {
    return new Response('Unknown export.', { status: 400, headers: { 'Content-Type': 'text/plain' } })
  }

  // The lender id is a request, never a permission: the query re-checks it
  // belongs to this account.
  const result = await loanExport(user.id, scope, status, params.get('lender') ?? '')
  if (!result) return new Response('That lender is not on this account.', { status: 400, headers: { 'Content-Type': 'text/plain' } })

  return new Response(new Uint8Array(result.file), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Length': String(result.file.length),
      'Content-Disposition': `attachment; filename="${result.fileName}"`,
      'Cache-Control': 'no-store',
    },
  })
}
