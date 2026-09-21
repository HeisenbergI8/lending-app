import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Printer } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { isReportKind, parseReportRange, rangeParams } from '@/lib/report-range.ts'
import { requireUser } from '@/server/auth/guard.ts'

import { ReportFrame } from '../report-frame.tsx'

export const metadata = { title: 'Report preview · Consignment Kush' }

const one = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? value[0] : value) ?? ''

/**
 * The same PDF, with the page to itself.
 *
 * The frame on the reports page is for checking the dates without losing the
 * form; this is for reading the document before handing it to someone. It is
 * the same file either way, from the same route.
 *
 * Nothing here queries the report. The frame asks /api/reports for it, and that
 * route is where the id is checked against this account — so a request for
 * somebody else's borrower is refused in one place rather than two.
 */
export default async function ReportPreviewPage({ searchParams }: PageProps<'/reports/preview'>) {
  await requireUser()
  const params = await searchParams

  const kind = one(params.kind)
  if (!isReportKind(kind)) notFound()

  const range = parseReportRange({ from: one(params.from), to: one(params.to) })
  const file = new URLSearchParams({ kind, id: one(params.id), ...rangeParams(range) })

  return (
    <div className="space-y-4">
      <Link
        href="/reports"
        className="text-muted-foreground hover:text-foreground -my-2 inline-flex min-h-11 items-center gap-1 py-2 text-sm pointer-fine:my-0 pointer-fine:min-h-0 pointer-fine:py-0"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Reports
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[1.75rem] font-semibold tracking-tight">Preview</h1>
          <p className="text-muted-foreground text-sm">This is the file Print will save.</p>
        </div>
        <Button asChild>
          <a href={`/api/reports?${file.toString()}`}>
            <Printer className="size-4" aria-hidden />
            Print
          </a>
        </Button>
      </div>

      <ReportFrame params={file} title="Report" className="h-[78vh] min-h-[32rem]" />
    </div>
  )
}
