import { isLoanExportStatus } from '@/lib/loan-export.ts'
import { getCurrentUser } from '@/server/auth/guard.ts'
import { loanExport } from '@/server/reports/loan-export.ts'

/**
 * The loan list as a Word file the browser saves — overall, every lender
 * grouped, or one lender's.
 *
 * A sibling of ../route.ts for the same reason as ../backup: that route renders
 * PDFs over a period, and this is a different file with no period.
 */

/**
 * The file name twice: a plain-ASCII copy for old readers, and the real one
 * percent-encoded, so a name like "Peña" survives. A header value outside
 * Latin-1 would otherwise make the response itself throw.
 */
function disposition(fileName: string): string {
  const ascii = fileName.normalize('NFKD').replace(/[^\x20-\x7E]/g, '').replace(/"/g, '')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return new Response(null, { status: 302, headers: { Location: '/login' } })

  const params = new URL(request.url).searchParams
  const who = params.get('who') ?? ''
  const status = params.get('status') ?? 'active'
  if (!who || !isLoanExportStatus(status)) {
    return new Response('Unknown export.', { status: 400, headers: { 'Content-Type': 'text/plain' } })
  }

  // A lender id is a request, never a permission: the query re-checks it
  // belongs to this account.
  const result = await loanExport(user.id, who, status)
  if (!result) return new Response('That lender is not on this account.', { status: 400, headers: { 'Content-Type': 'text/plain' } })

  return new Response(new Uint8Array(result.file), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Length': String(result.file.length),
      'Content-Disposition': disposition(result.fileName),
      'Cache-Control': 'no-store',
    },
  })
}
