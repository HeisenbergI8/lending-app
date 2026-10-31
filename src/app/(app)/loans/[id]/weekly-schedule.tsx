'use client'

import { Fragment, useActionState, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, ChevronDown, ImageIcon } from 'lucide-react'

import { ActionForm, SubmitButton } from '@/components/forms.tsx'
import { Money } from '@/components/money.tsx'
import { ProofInput } from '@/components/proof-input.tsx'
import { StatRow, StatTile } from '@/components/stat-tile.tsx'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NO_ERROR } from '@/lib/form-state.ts'
import { withSound } from '@/lib/sound.ts'
import { formatPesos } from '@/lib/money/centavos.ts'
import type { LoanDetail, LoanWeekRow } from '@/server/loans/queries.ts'
import { deleteProof } from '@/server/payments/actions.ts'
import type { ProofFileView } from '@/server/payments/queries.ts'
import { markWeekPaid, undoWeekPaid, weekProof } from '@/server/payments/week-actions.ts'

import { AddProofForm } from './payment-panel.tsx'
import { ProofList } from './proof-list.tsx'

/**
 * The week by week schedule of a loan that collects its interest weekly.
 *
 * BOTH DATES ARE ON THIS PAGE and neither stands in for the other. The Active
 * Loans list shows the next unpaid week, because that is what needs chasing;
 * this page shows that AND the capital date, because that is what was agreed.
 * FEATURES.md section 5.
 *
 * ONE WEEK AT A TIME. Only the earliest unpaid week carries a button. The rest
 * are rows. There is no paying ahead and no paying two weeks in one go, so
 * offering a button on week 9 while week 7 is owed would be offering something
 * the server refuses.
 *
 * TWENTY ROWS IS NOT A LIST ANYONE READS ON A PHONE, so it opens on the weeks
 * that matter — everything collected, plus the one being chased and the two
 * after it — with the rest behind a disclosure.
 *
 * The colours are the four status tokens and nothing else, and every state
 * ships an icon and a word beside the tint: the rule in CONVENTIONS.md, which
 * matters here more than anywhere because this is twenty rows of near-identical
 * figures distinguished mainly by state.
 */

const dateFormat = new Intl.DateTimeFormat('en-PH', { day: 'numeric', month: 'short', year: 'numeric' })

/** How many unpaid weeks to show before the disclosure. */
const WEEKS_AHEAD = 3

function today(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function WeekRow({ loanId, week }: { loanId: string; week: LoanWeekRow }) {
  const paid = week.paidOn !== null

  return (
    <li className="flex items-center justify-between gap-3 border-b border-border/50 py-2 last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-medium">
          Week {week.week}
          {week.withCapital ? (
            <span className="text-muted-foreground font-normal"> · with the capital</span>
          ) : null}
        </p>
        <p className="text-muted-foreground text-xs">
          {paid ? `Collected ${dateFormat.format(week.paidOn as Date)}` : `Due ${dateFormat.format(week.dueOn)}`}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {week.missingProof ? (
          <span className="text-status-critical inline-flex items-center gap-1 text-xs">
            <AlertTriangle className="size-3.5" aria-hidden />
            No proof
          </span>
        ) : null}
        {paid ? (
          <span className="text-status-good inline-flex items-center gap-1 text-xs">
            <CheckCircle2 className="size-3.5" aria-hidden />
            Collected
          </span>
        ) : null}
        {/* tabular-nums in a column, per CONVENTIONS.md: it stacks the decimal
            points, which is what makes twenty near-identical rows scannable. */}
        <Money amount={week.interest} variant="column" className="text-sm" />

        {/* UNDOING A WEEK RECORDED BY MISTAKE. Every other payment in this app can
            be undone and a collected week has to be too: it moves figures on five
            screens, and without this the only way back from a mistyped week would
            be editing the database.

            Confirmed, like every other undo here, because it moves money off
            those screens. The row is soft-deleted, so the proof stays attached and
            the week can be recorded again into the same row. */}
        {paid ? (
          <ActionForm
            action={undoWeekPaid}
            sound="restore"
            values={{ loanId, weekNumber: String(week.week) }}
            variant="ghost"
            size="sm"
            pendingLabel="Undoing…"
            confirm={{
              title: `Undo week ${week.week}?`,
              body: 'The week goes back to being owed and its share leaves floating funds. The proof stays attached, and recording it again reuses the same row.',
              action: 'Undo the week',
            }}
          >
            Undo
          </ActionForm>
        ) : null}
      </div>
    </li>
  )
}

/**
 * Seeing and attaching the proof of ONE collected week.
 *
 * Opened from the week's own row rather than shown on all twenty at once: this
 * is the exception, not the routine. A week collected through the conversion
 * flow never had proof offered — the screenshots for weeks paid before the app
 * knew about them are wherever they are — so this is how they arrive later.
 *
 * The files are fetched WHEN THE WEEK IS OPENED, not with the schedule: twenty
 * weeks of signed links on every render is the cost paymentForLoan's note warns
 * about. They are fetched again whenever the count changes, so a file attached
 * or removed here shows up without a reload.
 *
 * Whether it is open lives in WeeklySchedule, which hides the collect form while
 * it is: one upload box on screen, so a screenshot cannot go to the wrong week.
 */
function WeekProof({
  loanId,
  week,
  open,
  setOpen,
}: {
  loanId: string
  week: LoanWeekRow
  open: boolean
  setOpen: (open: boolean) => void
}) {
  if (!open) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        {week.missingProof ? (
          `Add proof for week ${week.week}`
        ) : (
          <>
            <ImageIcon className="size-4" aria-hidden />
            View proof for week {week.week} ({week.proofCount})
          </>
        )}
      </Button>
    )
  }

  return (
    <div className="space-y-3">
      {week.paymentId && week.proofCount > 0 ? (
        <WeekProofFiles paymentId={week.paymentId} count={week.proofCount} />
      ) : null}
      <AddProofForm loanId={loanId} paymentId={week.paymentId ?? undefined} />
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
        {week.missingProof ? 'Cancel' : 'Close'}
      </Button>
    </div>
  )
}

function WeekProofFiles({ paymentId, count }: { paymentId: string; count: number }) {
  // Keyed by what was fetched, so a stale answer is never shown as current and
  // "Loading" needs no state of its own.
  const [loaded, setLoaded] = useState<{ key: string; files: ProofFileView[] } | null>(null)
  const key = `${paymentId}:${count}`

  useEffect(() => {
    let live = true
    weekProof(paymentId).then((files) => {
      if (live) setLoaded({ key, files })
    })
    return () => {
      live = false
    }
  }, [paymentId, key])

  if (loaded?.key !== key) {
    return <p className="text-muted-foreground text-xs">Loading the proof…</p>
  }

  return (
    <ProofList
      files={loaded.files}
      remove={deleteProof}
      field="proofFileId"
      removeBody="It stops showing on this week. It is not listed on Recently Deleted, so put it back by uploading it again."
    />
  )
}

const markWeekPaidWithSound = withSound(markWeekPaid, 'cashIn')

/**
 * Collecting one week.
 *
 * Wrapped only for its sound, the same trade MarkPaidPanel makes. On success
 * the row it belongs to is replaced by the week that was just collected, so
 * nothing left on screen could play it afterwards.
 *
 * THE AMOUNT IS NOT A FIELD and neither is the week. Both are read from the
 * loan: the amount was fixed the day it was created, and the week is whichever
 * one is earliest unpaid. Neither can be mistyped because neither is typed.
 */
function MarkWeekPaidForm({ loanId, week }: { loanId: string; week: LoanWeekRow }) {
  const [state, formAction] = useActionState(markWeekPaidWithSound, NO_ERROR)

  return (
    <form action={formAction} className="bg-muted/40 space-y-3 rounded-xl p-3">
      <input type="hidden" name="loanId" value={loanId} />

      <p className="text-sm font-medium">
        Collect week {week.week}, {formatPesos(week.interest)}
      </p>
      <p className="text-muted-foreground text-xs">
        Due {dateFormat.format(week.dueOn)}. The capital stays out on loan.
      </p>

      <div className="space-y-2 sm:max-w-xs">
        <Label htmlFor="weekPaidOn">Date paid</Label>
        <Input id="weekPaidOn" name="paidOn" type="date" defaultValue={today()} required />
      </div>

      <ProofInput
        label="Proof of payment"
        hint="Optional. The screenshot, the chat, or both. They can be added later."
      />

      {state.error ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      <SubmitButton pendingLabel="Recording…" className="w-full sm:w-auto">
        <CheckCircle2 className="size-4" aria-hidden />
        Record week {week.week}
      </SubmitButton>
    </form>
  )
}

export function WeeklySchedule({ loan }: { loan: LoanDetail }) {
  const [showAll, setShowAll] = useState(false)
  // The week whose proof is open. It STAYS open once a file lands, so the Admin
  // sees what they just attached; Close brings the collect form back. Derived
  // against the live rows, so a week undone while open closes on its own.
  const [proofWeek, setProofWeek] = useState<number | null>(null)
  const addingProof = loan.weeks.some((week) => week.week === proofWeek && week.paymentId)

  const next = loan.weeks.find((week) => week.isNext) ?? null
  // Everything already collected, plus the week being chased and the two after
  // it. On a loan nobody has paid yet that is three rows, not twenty.
  const cutoff = (next?.week ?? loan.weeks.length) + WEEKS_AHEAD
  const shown = showAll ? loan.weeks : loan.weeks.filter((week) => week.paidOn !== null || week.week <= cutoff)
  const hidden = loan.weeks.length - shown.length

  return (
    <section className="bg-card space-y-3 rounded-2xl p-4 ring-1 ring-border/70 shadow-rest">
      <div>
        <h2 className="text-base font-semibold tracking-tight">Weekly interest</h2>
        <p className="text-muted-foreground mt-0.5 text-xs">
          The Admin collects the interest every week. The capital comes back on{' '}
          {dateFormat.format(loan.capitalDueOn)}, with the last week.
        </p>
      </div>

      {/* BOTH FIGURES COME FROM releasedOnFunding, in weeklyDetail in
          server/loans/queries.ts — the same rule behind every other collected
          figure in the app, so the tiles, the rows, the loans list and the
          dashboard cannot disagree about the same pesos.

          They are NOT added up from the rows below. Doing that gave this page
          its own second opinion, which differed by whole weeks on a loan with a
          skipped week.

          "Collected so far" is the sum of `interest` over the weeks with a live
          payment against them — interest only. The capital is not in it and has
          not moved: it is still under Out on loan on every lender's row until
          this loan is marked paid.

          "Still to collect" is the loan's whole total MINUS that sum, so it
          includes the capital plus every week not yet collected. It is what the
          borrower has left to hand over, which is why the two do not add up to
          anything on this page — one is interest, the other is interest and
          capital together. */}
      <StatRow>
        <StatTile
          label="Interest collected"
          value={<Money amount={loan.weeklyCollected} variant="display" muted={loan.weeklyCollected === 0} />}
        />
        <StatTile
          label="Still to collect"
          value={<Money amount={loan.weeklyOutstanding} variant="display" />}
        />
      </StatRow>

      {next && !next.withCapital && !addingProof ? <MarkWeekPaidForm loanId={loan.id} week={next} /> : null}

      {next?.withCapital ? (
        <p className="text-muted-foreground text-xs">
          Every week but the last has been collected. The final week is handed over with the capital,
          under Mark as paid.
        </p>
      ) : null}

      <ul className="text-sm">
        {/* A Fragment, not a wrapping <li>: a list item inside a list item is
            not valid HTML, and the attach control is its own row. */}
        {shown.map((week) => (
          <Fragment key={week.week}>
            <WeekRow loanId={loan.id} week={week} />
            {week.paymentId ? (
              <li className="border-b border-border/50 pb-2">
                <WeekProof
                  loanId={loan.id}
                  week={week}
                  open={addingProof && proofWeek === week.week}
                  setOpen={(open) => setProofWeek(open ? week.week : null)}
                />
              </li>
            ) : null}
          </Fragment>
        ))}
      </ul>

      {hidden > 0 ? (
        <Button type="button" variant="ghost" size="sm" onClick={() => setShowAll(true)}>
          <ChevronDown className="size-4" aria-hidden />
          Show {hidden} more {hidden === 1 ? 'week' : 'weeks'}
        </Button>
      ) : null}
    </section>
  )
}
