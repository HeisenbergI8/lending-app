import Link from 'next/link'
import { CalendarRange, Download, Expand, FileSpreadsheet, FileText, Printer } from 'lucide-react'

import { IconChip } from '@/components/stat-tile.tsx'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SelectNative } from '@/components/ui/select-native'
import { type ReportKind, isReportKind, parseReportRange, rangeParams } from '@/lib/report-range.ts'
import { requireUser } from '@/server/auth/guard.ts'
import { listBorrowerNames } from '@/server/borrowers/queries.ts'
import { listLenderNames } from '@/server/lenders/queries.ts'

import { ReportFrame } from './report-frame.tsx'

export const metadata = { title: 'Reports' }

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
 * THE PERIOD BELONGS TO THE PAGE, NOT TO EACH CARD. It used to sit in all three
 * forms, which meant the same two dates typed three times to produce three
 * reports for one month — and three cards that looked like the same form
 * repeated rather than three different reports. It now lives in the URL, set
 * once at the top, and each card carries it as hidden inputs. The cost is a
 * reload when the period changes, which is what the page did anyway.
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
  const range = parseReportRange({ from: one(params.from), to: one(params.to) })

  // Names only. These two feed dropdowns, so a track record or a lender ledger
  // would be computed and then thrown away.
  const [lenders, borrowers] = await Promise.all([listLenderNames(user.id), listBorrowerNames(user.id)])
  const dates = rangeParams(range)

  // Every card runs on the page's period. Only the person carries per card,
  // and only on the card that was actually asked about.
  const defaults = (cardKind: ReportKind) => ({ ...dates, id: kind === cardKind ? id : undefined })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[1.75rem] font-semibold tracking-tight">Reports</h1>
        <p className="text-muted-foreground text-sm">
          Preview the actual PDF, then print. The file is saved to the device and nothing is sent to anyone.
        </p>
      </div>

      <PeriodBar dates={dates} previewing={kind} id={id} />

      {/* Two across once there is room, and NO items-start: the cards in a row
          stretch to the tallest of them, so a card with a person to pick does
          not stand a head above one without. The borrower card spans the row
          rather than sitting alone in half of one, which is both the hole in
          the layout and the card with the most to fit. The card being previewed
          spans it too, because a PDF in half a column is a PDF nobody can read. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ReportCard
          title="Overall summary"
          description="What the Admin lent, what came back, what the Admin earned, and who is late."
          kind="summary"
          defaults={defaults('summary')}
          previewing={kind === 'summary'}
        />

        {/* No person to pick, so no dropdown: the Admin's cut is the Admin's.
            Sits second because it is the one report that is only about the
            Admin's own money, and the summary above it is about everyone's. */}
        <ReportCard
          title="Admin's cut"
          description="Every loan the Admin took a share of, with that share picked out. Loans made in the period, then loans repaid in it."
          kind="admin-cut"
          defaults={defaults('admin-cut')}
          previewing={kind === 'admin-cut'}
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
          wide
          // The full file is the same statement with every payment and proof
          // listed under its loan: the Admin's own records rather than something
          // to hand over.
          extraKind={{ kind: 'borrower-file', label: 'Full file' }}
          hint="Full file adds every payment and its proof, for the Admin’s own records."
        />
      </div>

      <BackupCard />

      <p className="text-muted-foreground text-xs">
        Floating funds, what is still out and what a borrower owes are always as of today, whatever
        period is picked — the ledger records movements, not nightly balances.
      </p>
    </div>
  )
}

/**
 * The whole loan book as an Excel file, for keeping rather than for handing over.
 *
 * SITS OUTSIDE THE GRID, and that is the design. The four cards above are
 * reports about a period, and this is a copy of everything — putting it among
 * them as a fifth card would make the period bar look like it applied to it.
 * Below the grid, with its own heading and the period ruled out in words, it
 * reads as the different kind of thing it is.
 *
 * A link, not a form: there is nothing to choose. No period, no person, no
 * preview — a spreadsheet previews itself in the program that opens it.
 */
function BackupCard() {
  return (
    <section className="bg-card flex flex-col gap-3 rounded-2xl p-4 ring-1 ring-border/70 shadow-rest">
      <div className="flex items-start gap-3">
        <IconChip icon={FileSpreadsheet} tint="mint" />
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight">Backup spreadsheet</h2>
          <p className="text-muted-foreground mt-0.5 text-sm">
            Every loan on the account in one Excel file: active, paid and pending. The period above
            does not apply.
          </p>
        </div>
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-3">
        <Button asChild>
          <a href="/api/reports/backup">
            <Download className="size-4" aria-hidden />
            Download Excel
          </a>
        </Button>
      </div>

      {/* The one exclusion worth a line on screen. What else the file does and
          does not cover is on its own Read me sheet, which is where somebody
          opening it six months from now will look. */}
      <p className="text-muted-foreground text-xs">Deleted loans are not in it.</p>
    </section>
  )
}

/**
 * The period every report on this page covers.
 *
 * One control, at the top, because it is one question: which stretch of time is
 * this page about. Applying it reloads the page with the dates in the URL, and
 * the cards below read them from there.
 *
 * A preview already open stays open and re-renders for the new dates, which is
 * why the kind and the person ride along as hidden inputs. Without them,
 * widening the range would close the very report being widened.
 */
function PeriodBar({
  dates,
  previewing,
  id,
}: {
  dates: { from: string; to: string }
  previewing: ReportKind | null
  id: string
}) {
  return (
    <form
      method="get"
      action="/reports"
      className="bg-card flex flex-wrap items-end gap-3 rounded-2xl p-4 ring-1 ring-border/70 shadow-rest"
    >
      {previewing ? (
        <>
          <input type="hidden" name="preview" value={previewing} />
          <input type="hidden" name="id" value={id} />
        </>
      ) : null}

      {/* On a phone the label takes a line of its own, so the two dates and
          Apply get the full width below it rather than three controls fighting
          over what is left beside the label. */}
      <div className="flex w-full items-center gap-2 self-center sm:w-auto">
        <IconChip icon={CalendarRange} tint="violet" />
        <span className="text-sm font-medium">Period</span>
      </div>

      <div className="min-w-0 flex-1 space-y-1 sm:max-w-40">
        <Label htmlFor="period-from" className="text-muted-foreground text-xs">
          From
        </Label>
        <Input id="period-from" name="from" type="date" defaultValue={dates.from} />
      </div>

      <div className="min-w-0 flex-1 space-y-1 sm:max-w-40">
        <Label htmlFor="period-to" className="text-muted-foreground text-xs">
          To
        </Label>
        <Input id="period-to" name="to" type="date" defaultValue={dates.to} />
      </div>

      <Button type="submit" variant="secondary">
        Apply
      </Button>
    </form>
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
  wide,
}: {
  title: string
  description: string
  kind: ReportKind
  /** The page's period, carried into this card's form, plus its own person. */
  defaults: { from: string; to: string; id?: string }
  /** Whether this card is the one the admin asked to see. */
  previewing: boolean
  people?: { id: string; name: string }[]
  peopleLabel?: string
  emptyPeople?: string
  extraKind?: { kind: ReportKind; label: string }
  hint?: string
  /** Span the whole row rather than half of it. */
  wide?: boolean
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
    <section
      className={cn(
        'bg-card flex flex-col gap-3 rounded-2xl p-4 ring-1 ring-border/70 shadow-rest',
        (wide || previewing) && 'lg:col-span-2',
      )}
    >
      <div className="flex items-start gap-3">
        <IconChip icon={FileText} tint="sky" />
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          <p className="text-muted-foreground mt-0.5 text-sm">{description}</p>
        </div>
      </div>

      {missingPeople ? (
        <p className="text-muted-foreground mt-auto text-sm">{emptyPeople}</p>
      ) : (
        <form method="get" action="/api/reports" className="mt-auto flex flex-wrap items-end gap-2">
          {/* The kind rides on the submit button when there is more than one, so
              each button is its own report and nothing has to be toggled first. */}
          {extraKind ? null : <input type="hidden" name="kind" value={kind} />}

          {/* The period the page is set to. Hidden rather than shown again:
              every card runs on the same one, and it is stated once above. */}
          <input type="hidden" name="from" value={defaults.from} />
          <input type="hidden" name="to" value={defaults.to} />

          {people ? (
            <div className="min-w-0 flex-1 space-y-1">
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

          {/* ONE LOUD BUTTON. Preview is what the admin came to do; Print and the
              full file are what they do next, and three equal buttons made the
              first choice look like a three-way one. */}
          <div className="flex flex-wrap gap-1">
            {/* PREVIEW GOES BACK TO THIS PAGE, print goes to the file. Same
                form, same dates, one `formaction` apart. */}
            <Button type="submit" formAction="/reports" name="preview" value={kind}>
              Preview
            </Button>
            <Button
              type="submit"
              variant="ghost"
              name={extraKind ? 'kind' : undefined}
              value={extraKind ? kind : undefined}
            >
              <Printer className="size-4" aria-hidden />
              Print
            </Button>
            {extraKind ? (
              <Button type="submit" variant="ghost" name="kind" value={extraKind.kind}>
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
