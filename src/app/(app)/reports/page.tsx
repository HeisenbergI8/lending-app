import Link from 'next/link'
import { Expand, FileText, Printer } from 'lucide-react'

import { IconChip } from '@/components/stat-tile.tsx'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SelectNative } from '@/components/ui/select-native'
import { type ReportKind, defaultRange, isReportKind, parseReportRange, rangeParams } from '@/lib/report-range.ts'
import { requireUser } from '@/server/auth/guard.ts'
import { listBorrowerNames } from '@/server/borrowers/queries.ts'
import { listLenderNames } from '@/server/lenders/queries.ts'

import { ReportFrame } from './report-frame.tsx'

export const metadata = { title: 'Reports · Consignment Kush' }

/**
 * Four reports, shown on the page and then printed as PDFs.
 *
 * THE PREVIEW IS THE PDF. Not a summary of it, not an HTML version of it — the
 * frame under a card is the very file the Print button saves, fetched from the
 * same route with `inline=1`. So there is nothing that can drift: what the admin
 * checks IS what she hands over.
 *
 * Plain GET forms: no JavaScript, no server action. Preview submits back to this
 * page and the frame appears under the card that asked for it; Print submits to
 * the route that renders the file, using the SAME form and therefore the same
 * dates. Two submit buttons with different `formaction`s, which is a plain HTML
 * form doing two things rather than a mode switch nobody would find.
 *
 * The app still sends nothing anywhere. Printing hands the file to the browser;
 * the admin forwards it herself, by decision in the spec.
 */

const one = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? value[0] : value) ?? ''

export default async function ReportsPage({ searchParams }: PageProps<'/reports'>) {
  const user = await requireUser()
  const params = await searchParams

  const asked = one(params.preview)
  const kind = isReportKind(asked) ? asked : null
  const id = one(params.id)
  const range = kind ? parseReportRange({ from: one(params.from), to: one(params.to) }) : defaultRange()

  // Names only. These two feed dropdowns, so a track record or a lender ledger
  // would be computed and then thrown away.
  const [lenders, borrowers] = await Promise.all([listLenderNames(user.id), listBorrowerNames(user.id)])
  const dates = rangeParams(range)

  // The card that was previewed keeps the dates and the person it was asked
  // about; the others go back to this month, because nothing was asked of them.
  const defaults = (cardKind: ReportKind) =>
    kind === cardKind ? { ...dates, id } : rangeParams(defaultRange())

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[1.75rem] font-semibold tracking-tight">Reports</h1>
        <p className="text-muted-foreground text-sm">
          Preview the actual PDF, then print. The file is saved to the device and nothing is sent to anyone.
        </p>
      </div>

      <ReportCard
        title="Overall summary"
        description="What the Admin lent, what came back, what the Admin earned, and who is late."
        kind="summary"
        defaults={defaults('summary')}
        previewing={kind === 'summary'}
      />

      <ReportCard
        title="Lender statement"
        description="For handing to a lender: their money in and out, which loans it funded, what it earned."
        kind="lender"
        defaults={defaults('lender')}
        previewing={kind === 'lender'}
        people={lenders.map((lender) => ({
          id: lender.id,
          name: `${lender.firstName} ${lender.lastName}${lender.isSelf ? ' (Admin)' : ''}`,
        }))}
        peopleLabel="Lender"
        emptyPeople="Add a lender first."
      />

      <ReportCard
        title="Borrower statement"
        description="What they borrowed, what they owe, when it is due, and what they have paid."
        kind="borrower"
        defaults={defaults('borrower')}
        previewing={kind === 'borrower'}
        people={borrowers.map((borrower) => ({
          id: borrower.id,
          name: `${borrower.firstName} ${borrower.lastName}`,
        }))}
        peopleLabel="Borrower"
        emptyPeople="Add a borrower first."
        // The full file is the same statement with every payment and proof
        // listed under its loan: the Admin's own records rather than something
        // to hand over.
        extraKind={{ kind: 'borrower-file', label: 'Full file' }}
        hint="Statement is the one to hand over. Full file adds every payment and its proof, for the Admin's own records. Both cover the dates picked above; widen them for everything on record."
      />

      <p className="text-muted-foreground text-xs">
        A range covers loans started, repayments received and money moved between those dates.
        Floating funds, what is still out and what a borrower owes are always as of today. The
        ledger records movements, not nightly balances, so it cannot honestly rewind them.
      </p>
    </div>
  )
}

function ReportCard({
  title,
  description,
  kind,
  defaults,
  previewing,
  people,
  peopleLabel,
  emptyPeople,
  extraKind,
  hint,
}: {
  title: string
  description: string
  kind: ReportKind
  defaults: { from: string; to: string; id?: string }
  /** Whether this card is the one the admin asked to see. */
  previewing: boolean
  people?: { id: string; name: string }[]
  peopleLabel?: string
  emptyPeople?: string
  extraKind?: { kind: ReportKind; label: string }
  hint?: string
}) {
  const id = kind
  const missingPeople = people !== undefined && people.length === 0
  const fileParams = new URLSearchParams({
    kind,
    id: defaults.id ?? '',
    from: defaults.from,
    to: defaults.to,
  })

  return (
    <section className="bg-card space-y-3 rounded-2xl p-4 ring-1 ring-border/70 shadow-rest">
      <div className="flex items-start gap-3">
        <IconChip icon={FileText} tint="sky" />
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          <p className="text-muted-foreground mt-0.5 text-sm">{description}</p>
        </div>
      </div>

      {missingPeople ? (
        <p className="text-muted-foreground text-sm">{emptyPeople}</p>
      ) : (
        <form
          method="get"
          action="/api/reports"
          className="grid gap-2 sm:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] sm:items-end"
        >
          {/* The kind rides on the submit button when there is more than one, so
              each button is its own report and nothing has to be toggled first. */}
          {extraKind ? null : <input type="hidden" name="kind" value={kind} />}

          {people ? (
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor={`${id}-person`} className="text-muted-foreground text-xs">
                {peopleLabel}
              </Label>
              <SelectNative id={`${id}-person`} name="id" defaultValue={defaults.id} required>
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </SelectNative>
            </div>
          ) : null}

          <div className="space-y-1">
            <Label htmlFor={`${id}-from`} className="text-muted-foreground text-xs">
              From
            </Label>
            <Input id={`${id}-from`} name="from" type="date" defaultValue={defaults.from} />
          </div>

          <div className="space-y-1">
            <Label htmlFor={`${id}-to`} className="text-muted-foreground text-xs">
              To
            </Label>
            <Input id={`${id}-to`} name="to" type="date" defaultValue={defaults.to} />
          </div>

          {/* One cell of an auto-fit grid, so its width comes from the other
              fields rather than from what the buttons need. The buttons no
              longer fit a single cell at any width, so the row is spanned. */}
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            {/* PREVIEW GOES BACK TO THIS PAGE, print goes to the file. Same
                form, same dates, one `formaction` apart. */}
            <Button type="submit" formAction="/reports" name="preview" value={kind}>
              Preview
            </Button>
            <Button
              type="submit"
              variant="secondary"
              name={extraKind ? 'kind' : undefined}
              value={extraKind ? kind : undefined}
            >
              <Printer className="size-4" aria-hidden />
              Print
            </Button>
            {extraKind ? (
              <Button type="submit" variant="secondary" name="kind" value={extraKind.kind}>
                {extraKind.label}
              </Button>
            ) : null}
          </div>
        </form>
      )}

      {previewing ? (
        <div className="border-border space-y-3 border-t pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">This is the file Print will save.</p>
            <Button asChild variant="outline" size="sm">
              <Link href={`/reports/preview?${fileParams.toString()}`}>
                <Expand className="size-4" aria-hidden />
                Full screen
              </Link>
            </Button>
          </div>
          <ReportFrame params={fileParams.toString()} title={title} />
        </div>
      ) : null}

      {hint && !missingPeople ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </section>
  )
}
