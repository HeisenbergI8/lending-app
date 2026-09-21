import { Download, FileText } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SelectNative } from '@/components/ui/select-native'
import { defaultRange, rangeParams } from '@/lib/report-range.ts'
import { requireUser } from '@/server/auth/guard.ts'
import { listBorrowers } from '@/server/borrowers/queries.ts'
import { listLenders } from '@/server/lenders/queries.ts'

export const metadata = { title: 'Reports · Lending App' }

/**
 * Four reports, as PDFs saved to the device.
 *
 * Plain GET forms pointed at the route that renders them: no JavaScript, no
 * server action, and the browser does what it already does with an attachment.
 * The app sends nothing anywhere — by decision in the spec, the admin forwards
 * the file herself.
 *
 * Each form carries its own dates rather than sharing one set. Three little
 * forms that each do one thing beat one form with a mode switch, especially on
 * a phone where the person can only see one of them at a time anyway.
 */
export default async function ReportsPage() {
  const user = await requireUser()
  const [lenders, borrowers] = await Promise.all([listLenders(user.id), listBorrowers(user.id)])
  const range = rangeParams(defaultRange())

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
        <p className="text-muted-foreground text-sm">
          Saved to your device as a PDF. Nothing is sent to anyone.
        </p>
      </div>

      <ReportCard
        title="Overall summary"
        description="What you lent, what came back, what you earned, and who is late."
        kind="summary"
        range={range}
      />

      <ReportCard
        title="Lender statement"
        description="For handing to a lender: their money in and out, which loans it funded, what it earned."
        kind="lender"
        range={range}
        people={lenders.map((lender) => ({
          id: lender.id,
          name: `${lender.firstName} ${lender.lastName}${lender.isSelf ? ' (you)' : ''}`,
        }))}
        peopleLabel="Lender"
        emptyPeople="Add a lender first."
      />

      <ReportCard
        title="Borrower statement"
        description="What they borrowed, what they owe, when it is due, and what they have paid."
        kind="borrower"
        range={range}
        people={borrowers.map((borrower) => ({
          id: borrower.id,
          name: `${borrower.firstName} ${borrower.lastName}`,
        }))}
        peopleLabel="Borrower"
        emptyPeople="Add a borrower first."
        // The full file is the same statement with every payment and proof
        // listed under its loan — the admin's own records rather than something
        // to hand over.
        extraKind={{ kind: 'borrower-file', label: 'Full file' }}
        hint="The full file covers the dates you pick — widen them for everything on record."
      />

      <p className="text-muted-foreground text-xs">
        A range covers loans started, repayments received and money moved between those dates.
        Floating funds, what is still out and what a borrower owes are always as of today — the
        ledger records movements, not nightly balances, so it cannot honestly rewind them.
      </p>
    </div>
  )
}

function ReportCard({
  title,
  description,
  kind,
  range,
  people,
  peopleLabel,
  emptyPeople,
  extraKind,
  hint,
}: {
  title: string
  description: string
  kind: string
  range: { from: string; to: string }
  people?: { id: string; name: string }[]
  peopleLabel?: string
  emptyPeople?: string
  extraKind?: { kind: string; label: string }
  hint?: string
}) {
  const id = kind
  const missingPeople = people !== undefined && people.length === 0

  return (
    <section className="bg-card space-y-3 rounded-xl border p-4">
      <div className="flex items-start gap-3">
        <FileText className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
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
              <SelectNative id={`${id}-person`} name="id" required>
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
            <Input id={`${id}-from`} name="from" type="date" defaultValue={range.from} />
          </div>

          <div className="space-y-1">
            <Label htmlFor={`${id}-to`} className="text-muted-foreground text-xs">
              To
            </Label>
            <Input id={`${id}-to`} name="to" type="date" defaultValue={range.to} />
          </div>

          <div className="flex gap-2">
            <Button type="submit" name={extraKind ? 'kind' : undefined} value={extraKind ? kind : undefined}>
              <Download className="size-4" aria-hidden />
              {extraKind ? 'Statement' : 'Download'}
            </Button>
            {extraKind ? (
              <Button type="submit" variant="secondary" name="kind" value={extraKind.kind}>
                {extraKind.label}
              </Button>
            ) : null}
          </div>
        </form>
      )}

      {hint && !missingPeople ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </section>
  )
}
