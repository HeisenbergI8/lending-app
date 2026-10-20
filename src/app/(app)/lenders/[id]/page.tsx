import type { ReactNode } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowDownLeft, ArrowLeft, ArrowUpRight, CalendarRange, ChevronDown, ChevronRight, HandCoins, History, Scissors, Wallet } from 'lucide-react'

import { LoanStatusBadge } from '@/components/loan-status.tsx'
import { Avatar } from '@/components/avatar.tsx'
import { Money } from '@/components/money.tsx'
import { Pager } from '@/components/pager.tsx'
import { IconChip, StatTile } from '@/components/stat-tile.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { type Centavos, centavos } from '@/lib/money/centavos.ts'
import { formatListDate } from '@/lib/dates.ts'
import { addDays, calendarDate, describeTerm, parseCalendarDate, toDateInput } from '@/lib/money/weeks.ts'
import { type Projection } from '@/lib/money/projection.ts'
import { PAGE_SIZE, pagedHref, parsePage } from '@/lib/pagination.ts'
import { HISTORY_FILTERS, type HistoryFilterKey, filterHistory, parseHistoryFilter } from '@/lib/money/history-filter.ts'
import { cn } from '@/lib/utils'
import {
  type ReportRange,
  describeRange,
  parseReportRange,
  rangeDays,
  rangeParams,
  rangePresets,
  sameRange,
} from '@/lib/report-range.ts'
import { requireUser } from '@/server/auth/guard.ts'
import { type LenderDetail, getLender, projectedFloating } from '@/server/lenders/queries.ts'
import { borrowerPhotoUrls } from '@/server/storage/borrower-photos.ts'

import { LenderSettings } from './lender-settings.tsx'
import { EditTransaction, TransactionForm } from './transaction-form.tsx'
import { ChangeCapitalForm } from './capital-history.tsx'
import { HoldNoteRow } from './hold-note.tsx'
import { WhereTheMoneyIs } from './where-the-money-is.tsx'

/** First value only. A query string can carry a key twice; a date box cannot. */
const one = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? value[0] : value) ?? ''

const percent = (bps: number) => `${(bps / 100).toLocaleString('en-PH', { maximumFractionDigits: 2 })}%`

/**
 * What this pot earns, in the lender's own words.
 *
 * Built from the rates on their funding rows, never from the default. The rate
 * is decided per loan, so a fixed "earns 5% a week" here would be a claim the
 * screen cannot back up — and the first loan written at another rate would make
 * it false without anything appearing to change.
 */
function describeRates(rates: number[], fixedAmountLoans: number, isSelf: boolean): string {
  const owner = isSelf ? 'The Admin pot' : null

  if (rates.length === 0) {
    if (fixedAmountLoans > 0) {
      return owner
        ? `${owner}. Every loan it funds charges a fixed amount, not a rate.`
        : 'Every loan of theirs charges a fixed amount, not a rate.'
    }
    return owner ? `${owner}. Nothing lent out yet.` : 'Nothing of theirs is lent out yet.'
  }

  const span =
    rates.length === 1
      ? `${percent(rates[0])} a week`
      : `${percent(rates[0])} to ${percent(rates[rates.length - 1])} a week, depending on the loan`

  // A loan charging a fixed amount has no rate to fold into that span, so it is
  // named separately. Leaving it out would let the sentence describe part of the
  // pot as though it were all of it.
  const fixed =
    fixedAmountLoans === 0
      ? ''
      : fixedAmountLoans === 1
        ? ' One other loan charges a fixed amount instead.'
        : ` ${fixedAmountLoans} other loans charge a fixed amount instead.`

  return owner
    ? `${owner}. This money earns ${span}, the whole of what the borrower pays.${fixed}`
    : `Earns ${span} on their own capital.${fixed}`
}

/**
 * The ten rows a page number covers.
 *
 * Sliced HERE rather than in the query, because every figure on this page is a
 * sum over the whole list — floating, out on loan, the cut, the month columns.
 * Fetching ten rows would make each of those a separate round trip to add up
 * what is already in hand, and the lists are one lender's own history, not the
 * whole ledger.
 *
 * Named `pageOf` rather than `page`, which is what a helper in a file called
 * page.tsx should not be called: the word already means the route here, and a
 * reader hitting `page(rows, at)` has to stop and work out which one it is.
 */
function pageOf<T>(rows: readonly T[], at: number): T[] {
  return rows.slice((at - 1) * PAGE_SIZE, at * PAGE_SIZE)
}

/** "2026-09-21" for <input type="date">, in the admin's own timezone. */
function todayForInput(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/**
 * This page with a different period on it, and nothing else disturbed.
 *
 * The preset chips are links rather than buttons so each period is a URL, and a
 * URL has to carry the page numbers of the six lists below it — otherwise
 * tapping "Last month" would also send the Admin back to the top of all six.
 * Page 1 is the default and is left out, which keeps an unpaged URL clean.
 */
function rangeHref(lenderId: string, range: ReportRange, paging: Record<string, number>): string {
  const query = new URLSearchParams(rangeParams(range))
  for (const [key, page] of Object.entries(paging)) {
    if (page > 1) query.set(key, String(page))
  }
  return `/lenders/${lenderId}?${query}`
}

/**
 * What this pot earned over a stretch of time the admin picks.
 *
 * WHY IT IS A CARD OF ITS OWN AND NOT A FOURTH TILE. Every other figure on this
 * screen is a fact about today — floating, out on loan, interest still to
 * collect. This one is a fact about a period, and the two do not belong side by
 * side: a period control sitting above a row of tiles promises that it filters
 * all of them, and a fourth figure on that row invites being added to the other
 * three. Neither is true. Sitting in its own card with its own dates, the
 * control cannot claim a reach it does not have.
 *
 * IT REPLACED THE "Earned" TILE, which showed every peso of profit ever
 * received. That figure answered "how much has this pot made, all time" when the
 * question being asked of it was "how much did it make last month" — and on the
 * Admin pot it was carrying the cut on other lenders' capital with nothing on
 * screen to say so.
 *
 * WHAT THE FIGURE IS, exactly. `lender.rangeInterest` is the stored interest on
 * this pot's live funding rows — `earningsCentavos`, plus `adminCutCentavos` on
 * every other funder's row when this IS the Admin pot — SPREAD ACROSS THE DAYS
 * OF EACH LOAN'S AGREED TERM and cut to the days that fall in the range. Never
 * recomputed from a rate. Deleted loans are out; a loan's status is not
 * consulted, so a repaid loan still reports what it earned in the months it ran.
 * See server/lenders/queries.ts interestAccruedIn and lib/money/accrual.ts.
 *
 * SO IT IS NOT CASH AND THE NOTE HAS TO SAY SO. A loan collected at the end pays
 * nothing during the months counted here; a weekly loan pays as it goes. The
 * figure is the same either way, because what it measures is what the money
 * earned, not what arrived. Adding it to Floating, or to Earned on the lenders
 * list, double counts.
 *
 * IT RECONCILES AGAINST NOTHING ELSE ON THE PAGE over a short range, and that is
 * correct rather than a gap to close. Over a range wide enough to cover every
 * loan's whole term it equals this pot's total interest, which is `earned +
 * pending` on the tiles below. Over one month it equals neither, on purpose.
 */
function EarnedOverPeriod({
  lenderId,
  amount,
  range,
  isSelf,
  paging,
}: {
  lenderId: string
  amount: Centavos
  range: ReportRange
  isSelf: boolean
  paging: Record<string, number>
}) {
  const dates = rangeParams(range)
  const days = rangeDays(range)
  const presets = rangePresets()

  return (
    <section className="bg-card overflow-hidden rounded-2xl ring-1 ring-border/70 shadow-rest">
      <div className="space-y-3 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <IconChip icon={CalendarRange} tint="mint" />
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight">Interest earned</h2>
            {/* THE DAY COUNT SITS WITH THE DATES because the figure is a sum over
                days, and two ranges are only comparable when their lengths are.
                "Aug 1 to Aug 31" next to "Sep 1 to Sep 25" looks like a fair
                comparison until the 31 and the 25 are said out loud. */}
            <p className="text-muted-foreground text-sm">
              {describeRange(range)} · {days === 1 ? '1 day' : `${days} days`}
            </p>
          </div>
        </div>

        {/* THE FIGURE MOVED OUT OF THE TOP-RIGHT CORNER and under its own
            heading. Pinned to the far edge of a full-width card it sat a hand's
            width from the words that say what it is, and on a wide screen the
            eye has to travel the whole card to pair them. Directly beneath the
            heading there is nothing to pair it with but the right label. */}
        <Money
          amount={amount}
          variant="display"
          muted={amount === 0}
          className="block text-3xl font-semibold sm:text-4xl"
        />

        {/* THE SENTENCE THE FIGURE CANNOT BE READ WITHOUT. It is the spread that
            makes a month comparable to another month, and it is also the thing
            that makes this figure not cash. Both halves are said, because either
            on its own is misleading: the first alone reads as money received, and
            the second alone reads as an estimate.

            Zero has its own line. On a pot with nothing on loan in the period,
            "spread across the days each loan ran" describes no loan at all. */}
        <p className="text-muted-foreground max-w-prose text-sm text-pretty">
          {amount === 0
            ? 'None of this money was out on loan during these dates.'
            : isSelf
              ? 'Spread across the days each loan ran, so a loan crossing two months counts in both. This is what the money earned over these dates, not what was collected in them. It includes the cut charged on other lenders’ capital.'
              : 'Spread across the days each loan ran, so a loan crossing two months counts in both. This is what the money earned over these dates, not what was collected in them.'}
        </p>
      </div>

      {/* THE CONTROLS GET THEIR OWN SHADED FOOT, divided off from the reading
          above it. In one flat card the dates read as part of the statement
          being made; below a line they read as what they are — the thing that
          changes it. The tint is the same one the app uses for a muted surface,
          so nothing new had to be invented for it. */}
      <div className="bg-muted/40 space-y-3 border-t border-border/70 p-4 sm:p-5">
        {/* PRESETS ARE PLAIN LINKS, not buttons, so each one is a URL that can be
            reloaded, bookmarked or sent to somebody — the same property the two
            date boxes already had by being a GET form. They carry the page
            numbers for the same reason the form's hidden inputs do.

            The one matching the dates on screen is marked `aria-current`, which
            is also what draws the filled style: a row of four identical chips
            with no sign of which is in force is a set of buttons that look like
            they do nothing. A hand-typed range matches none of them, and then
            none is filled, which is correct. */}
        <div className="flex flex-wrap gap-1.5">
          {presets.map((preset) => {
            const active = sameRange(preset.range, range)
            return (
              <Link
                key={preset.key}
                href={rangeHref(lenderId, preset.range, paging)}
                aria-current={active ? 'true' : undefined}
                className={cn(
                  'inline-flex min-h-9 items-center rounded-full px-3 text-[0.8rem] font-medium transition-colors',
                  'focus-visible:ring-ring/50 outline-none focus-visible:ring-3',
                  active
                    ? 'bg-foreground text-background'
                    : 'bg-background text-muted-foreground ring-border/70 hover:text-foreground ring-1 hover:bg-muted',
                )}
              >
                {preset.label}
              </Link>
            )
          })}
        </div>

        {/* A PLAIN GET FORM, like the period bar on Reports. The dates land in the
            URL, so a month the Admin is looking at is a link that survives a
            reload and can be sent to somebody.

            THE PAGE NUMBERS RIDE ALONG as hidden inputs. Six lists on this page
            carry their own key in the query string, and submitting a form sends
            only its own fields: without these, changing the dates would silently
            throw the Admin back to page 1 of all six. Page 1 is the default and is
            left out, which keeps the URL of an unpaged page clean. */}
        <form
          method="get"
          action={`/lenders/${lenderId}`}
          className="flex flex-wrap items-end gap-2 sm:gap-3"
        >
          {Object.entries(paging)
            .filter(([, page]) => page > 1)
            .map(([key, page]) => (
              <input key={key} type="hidden" name={key} value={page} />
            ))}

          <div className="min-w-0 flex-1 space-y-1 sm:max-w-40">
            <Label htmlFor="earned-from" className="text-muted-foreground text-xs">
              From
            </Label>
            <Input id="earned-from" name="from" type="date" defaultValue={dates.from} />
          </div>

          <div className="min-w-0 flex-1 space-y-1 sm:max-w-40">
            <Label htmlFor="earned-to" className="text-muted-foreground text-xs">
              To
            </Label>
            <Input id="earned-to" name="to" type="date" defaultValue={dates.to} />
          </div>

          <Button type="submit" variant="secondary">
            Apply
          </Button>
        </form>
      </div>
    </section>
  )
}

export async function generateMetadata({ params }: PageProps<'/lenders/[id]'>) {
  const user = await requireUser()
  const lender = await getLender(user.id, (await params).id)
  if (!lender) return { title: 'Lender' }
  return { title: `${lender.firstName} ${lender.lastName}` }
}

/**
 * One lender's pot.
 *
 * The screen exists to answer one question without opening every loan: where is
 * this person's money right now? So "Out with" comes before the transaction
 * history — the history explains the figures, but the figures are what was asked.
 *
 * Every number here is derived on this read. Nothing on this page is stored as a
 * balance, which is why none of it can drift away from the rows that produced it.
 */
export default async function LenderPage({ params, searchParams }: PageProps<'/lenders/[id]'>) {
  const user = await requireUser()
  const query = await searchParams

  /* THE PERIOD IS FOR ONE FIGURE, not for the page. It reaches the query because
     "what did this pot earn in September" cannot be derived from anything the
     page already has — the interest has to be spread over the days each loan
     ran, which needs every funding row's start date and term.

     Nothing else on this screen is ranged, and the dates must never be allowed
     to look as though they are. Floating, out on loan and interest to collect are
     facts about today; report-range.ts explains why the ledger cannot honestly
     answer them "as of last March". That is why the period control lives inside
     the earned-over-a-period card rather than above the row of tiles. */
  const range = parseReportRange({ from: one(query.from), to: one(query.to) })

  const [lender, photos] = await Promise.all([getLender(user.id, (await params).id, range), borrowerPhotoUrls(user.id)])
  if (!lender) notFound()

  const { position } = lender

  /* AVAILABLE ON A DATE. `on` is a day the Admin picked; today or later only,
     because a projection of the past is not a projection — what the pot held
     then is history, and the money history below has it. */
  const today = calendarDate(new Date())
  const onRaw = one(query.on)
  const on = parseCalendarDate(onRaw)
  const projection =
    on && on.getTime() >= today.getTime() ? await projectedFloating(user.id, lender, position.floating, on) : null
  const settledEarnings = centavos(lender.settled.reduce((total, row) => total + row.earnings, 0))

  /* FIVE LISTS, FIVE PAGE NUMBERS. Every list on this page is capped at ten rows,
     each with its own key in the query string, so paging the money history does
     not send the loan lists back to the top.

     The counts in the section headings and the figures in the tiles are still
     computed over EVERY row, never over the ten on screen. That is the whole
     point of paging here: the reading stays complete while the scrolling gets
     shorter. The Pager prints "1-10 of 14" underneath so the ten are never
     mistaken for all of them. */
  const href = pagedHref(`/lenders/${lender.id}`, query)
  const paging = {
    cutsOut: parsePage(query.cutsOut).page,
    cutsPaid: parsePage(query.cutsPaid).page,
    out: parsePage(query.out).page,
    paid: parsePage(query.paid).page,
    history: parsePage(query.history).page,
  }
  const historyFilter = parseHistoryFilter(one(query.show))

  /* THE PART OF "Where the money is" THAT IS SELECTED, and what it does to the
     "Out with" list: 'loan' keeps the loans that are not overdue, 'late' keeps
     the overdue ones, anything else shows them all. Its own key, `part`, because
     `show` already belongs to the money history filter. */
  const part = one(query.part) || null
  const isLate = (row: { state: string }) => row.state === 'overdue'
  const shownFundings =
    part === 'late' ? lender.fundings.filter(isLate) : part === 'loan' ? lender.fundings.filter((row) => !isLate(row)) : lender.fundings
  const overdueCapital = centavos(lender.fundings.filter(isLate).reduce((total, row) => total + row.principal, 0))
  /* WHAT THE "Out with" ROWS ON SCREEN EARN, added up: the "earns" figure on
     each row, over every row the filter keeps (not just the ten on this page).
     This pot's own share only — the Admin cut belongs to none of these rows,
     which is why it can differ from Interest coming + Cut coming above. */
  const shownEarnings = centavos(shownFundings.reduce((total, row) => total + row.earnings, 0))
  /** This page with a part selected (or none), the "Out with" list back on page 1. */
  const partHref = (key: string | null, anchor = 'where') => {
    const next = new URLSearchParams()
    for (const [name, value] of Object.entries(query)) {
      const first = one(value)
      if (first && name !== 'part' && name !== 'out') next.set(name, first)
    }
    if (key) next.set('part', key)
    const search = next.toString()
    return `/lenders/${lender.id}${search ? `?${search}` : ''}#${anchor}`
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/lenders"
          className="text-muted-foreground hover:text-foreground -my-2 inline-flex min-h-11 items-center gap-1 py-2 text-sm pointer-fine:my-0 pointer-fine:min-h-0 pointer-fine:py-0"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Lenders
        </Link>

        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[1.75rem] font-semibold tracking-tight">
              {lender.firstName} {lender.lastName}
            </h1>
            <p className="text-muted-foreground text-sm">
              {describeRates(lender.rates, lender.fixedAmountLoans, lender.isSelf)}
            </p>
          </div>
          <LenderSettings
            lenderId={lender.id}
            firstName={lender.firstName}
            lastName={lender.lastName}
            isSelf={lender.isSelf}
          />
        </div>
      </div>

      <StatTile
        hero
        icon={Wallet}
        label="Floating"
        value={<Money amount={position.floating} variant="display" />}
        note={position.floating < 0 ? 'more is out on loan than was ever put in' : 'idle, ready to lend'}
        tone={position.floating < 0 ? 'critical' : undefined}
      />

      <FloatingOnDate
        lenderId={lender.id}
        isSelf={lender.isSelf}
        query={query}
        today={today}
        raw={onRaw}
        on={projection ? on : null}
        projection={projection}
      />

      <EarnedOverPeriod
        lenderId={lender.id}
        amount={lender.rangeInterest}
        range={lender.range}
        isSelf={lender.isSelf}
        paging={paging}
      />

      {/* WHERE THE MONEY IS: Pot total, split into the parts it is made of.
          Replaced the four tiles (Starting capital, Pot total, Out on loan,
          Interest to collect) on 2026-10-14 at the owner's request. Starting
          capital lives in its own section further down.

          THE PARTS ADD UP TO POT TOTAL and nothing is counted twice:
            Ready to lend     position.floating
            Out on loan       position.outOnLoan minus the overdue part
            Overdue           principal on this pot's running loans whose state is
                              'overdue' — the same storedLoanState test the
                              "Out with" badges use, so the slice and the red
                              badges below always agree
            Interest coming   position.pending minus the Admin cut in it: this
                              pot's own interest on loans not yet paid
            Cut coming        position.adminCutPending, the Admin pot only
          Pot total is floating + outOnLoan + pending, the sum verified against
          the database on 2026-09-23 (see the history of this file). `earned` is
          already inside floating and is deliberately not a part.

          Interest coming and Cut coming are expectations, not cash, and a loan
          already overdue still counts at its full value: this ledger has no way
          to write one off. */}
      <WhereTheMoneyIs
        potTotal={centavos(position.floating + position.outOnLoan + position.pending)}
        selected={part}
        clearHref={partHref(null)}
        parts={[
          {
            key: 'ready',
            label: 'Ready to lend',
            amount: position.floating,
            color: 'var(--status-good)',
            href: partHref('ready'),
            next: { label: 'Lend this money →', href: '/loans/new' },
          },
          {
            key: 'loan',
            label: 'Out on loan',
            amount: centavos(position.outOnLoan - overdueCapital),
            color: 'var(--series-1)',
            href: partHref('loan'),
            next: { label: 'See these loans ↓', href: partHref('loan', 'out-with') },
          },
          {
            key: 'late',
            label: 'Overdue',
            amount: overdueCapital,
            color: 'var(--status-critical)',
            href: partHref('late'),
            next: { label: 'See the overdue loans ↓', href: partHref('late', 'out-with') },
          },
          {
            key: 'interest',
            label: 'Interest coming',
            amount: centavos(position.pending - position.adminCutPending),
            color: 'var(--series-2)',
            href: partHref('interest'),
            next: { label: 'See what each loan earns ↓', href: partHref('interest', 'out-with') },
          },
          ...(lender.isSelf
            ? [
                {
                  key: 'cut',
                  label: 'Cut coming',
                  amount: position.adminCutPending,
                  color: 'var(--series-3)',
                  href: partHref('cut'),
                  next: { label: 'See where the cut comes from ↓', href: partHref('cut', 'cuts-running') },
                },
              ]
            : []),
        ]}
      />

      {/* WHERE THE CUT COMES FROM. Cut coming above, and Earned, carry money that belongs
          to none of the loans listed further down this page, because the cut is
          charged on capital that is not this pot's. This is that money, one row
          per funding row it was taken on, and each list sums to exactly the
          figure it names: `running` to position.adminCutPending, `settled` to
          position.adminCutEarned. Same rows, same test, added up in
          splitCuts rather than in lenderPosition.

          Only the Admin pot has any. On every other lender the query is not run
          and both lists are empty, so this renders nowhere else. */}
      {lender.adminCuts.running.length > 0 || lender.adminCuts.settled.length > 0 ? (
        <section className="space-y-3">
          <div className="flex items-start gap-3">
            <IconChip icon={Scissors} tint="amber" />
            <div className="min-w-0">
              <h2 className="text-base font-semibold tracking-tight">Where the Admin cut comes from</h2>
              <p className="text-muted-foreground mt-0.5 text-sm">
                The cut is charged on other lenders&rsquo; capital, so it is in the figures above and
                in none of the loans below. This is every peso of it.
              </p>
            </div>
          </div>

          <CutList
            id="cuts-running"
            title="On loans still running"
            rows={lender.adminCuts.running}
            total={position.adminCutPending}
            empty="No running loan is funded by anyone else right now."
            page={paging.cutsOut}
            photos={photos}
            href={href('cutsOut', 'cuts-running')}
            retractable
            open={part === 'cut'}
          />
          <CutList
            id="cuts-repaid"
            title="On loans repaid"
            rows={lender.adminCuts.settled}
            total={position.adminCutEarned}
            empty="No loan funded by anyone else has been repaid yet."
            page={paging.cutsPaid}
            photos={photos}
            href={href('cutsPaid', 'cuts-repaid')}
            retractable
          />
        </section>
      ) : null}

      <section id="out-with" className="scroll-mt-4 space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-base font-semibold tracking-tight">
            Out with
            {part === 'late' ? <span className="text-status-critical"> · overdue only</span> : null}
            {part === 'loan' ? <span className="text-muted-foreground font-normal"> · on time only</span> : null}
          </h2>
          {shownFundings.length > 0 ? (
            <p className="text-muted-foreground text-xs">
              {shownFundings.length === 1 ? '1 loan' : `${shownFundings.length} loans`} · earns{' '}
              <Money amount={shownEarnings} variant="display" />
            </p>
          ) : null}
        </div>

        {part === 'late' || part === 'loan' ? (
          <Link href={partHref(null, 'out-with')} scroll={false} className="text-brand -mt-1 inline-block text-xs font-medium">
            Show all {lender.fundings.length === 1 ? '1 running loan' : `${lender.fundings.length} running loans`}
          </Link>
        ) : null}

        {shownFundings.length === 0 ? (
          <p className="text-muted-foreground bg-card/60 border-border rounded-2xl border border-dashed p-6 text-center text-sm">
            {part === 'late'
              ? 'No loan of this money is overdue.'
              : part === 'loan'
                ? 'Every running loan of this money is overdue.'
                : 'None of this money is out on loan right now.'}
          </p>
        ) : (
          <ul className="space-y-2">
            {pageOf(shownFundings, paging.out).map((funding) => (
              <li key={funding.loanId}>
                <Link
                  href={`/borrowers/${funding.borrowerId}`}
                  className="bg-card group flex items-center gap-3 p-3 rounded-2xl ring-1 ring-border/70 shadow-rest hover:shadow-hover hover:ring-brand-line transition-[box-shadow,--tw-ring-color] duration-200"
                >
                  <Avatar name={funding.borrowerName} photo={photos.get(funding.borrowerId)} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{funding.borrowerName}</div>
                    {/* Two lines, each one kind of fact: when, then the money.
                        The figures are a shade darker than the words around them. */}
                    <div className="text-muted-foreground mt-0.5 text-xs">
                      <span className="whitespace-nowrap">{funding.reminderOn ? `Reminder ${formatListDate(funding.reminderOn)}` : `Due ${formatListDate(funding.dueOn)}`}</span> ·{' '}
                      <span className="whitespace-nowrap">{describeTerm(funding.termDays)}</span>
                    </div>
                    <div className="text-muted-foreground text-xs">
                      {/* Each phrase kept whole, so a narrow screen breaks the
                          line at the "+" and never between a figure and its word. */}
                      <span className="whitespace-nowrap">
                        <Money amount={funding.principal} variant="display" className="text-foreground/80" /> capital +
                      </span>{' '}
                      <span className="whitespace-nowrap">
                        earns <Money amount={funding.earnings} variant="display" className="text-foreground/80" />
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {/* This pot's capital plus its own stored share of the interest,
                        so the Admin cut is already out of it on another lender's
                        row. Never the borrower's total. */}
                    <Money
                      amount={centavos(funding.principal + funding.earnings)}
                      variant="display"
                      className="text-sm font-semibold"
                    />
                    <LoanStatusBadge state={funding.state} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}

        <Pager
          page={paging.out}
          total={shownFundings.length}
          noun="loans"
          href={href('out', 'out-with')}
        />
      </section>

      {/* WHO HAS ALREADY PAID THIS POT BACK. "Out with" above is the money at
          risk; this is the track record beside it, and the two answer different
          questions. Kept forever, the same as on a borrower's own profile. */}
      <Retractable
        id="paid-back"
        open={paging.paid > 1}
        header={
          <>
            <h2 className="text-base font-semibold tracking-tight">Paid back</h2>
            {lender.settled.length > 0 ? (
              <p className="text-muted-foreground text-xs">
                {lender.settled.length === 1 ? '1 loan settled' : `${lender.settled.length} loans settled`} ·{' '}
                <Money amount={settledEarnings} variant="display" /> earned
              </p>
            ) : null}
          </>
        }
      >

        {lender.settled.length === 0 ? (
          <p className="text-muted-foreground bg-card/60 border-border rounded-2xl border border-dashed p-6 text-center text-sm">
            No loan funded by this money has been repaid yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {pageOf(lender.settled, paging.paid).map((funding) => (
              <li key={funding.loanId}>
                <Link
                  href={`/loans/${funding.loanId}`}
                  className="bg-card group flex items-center gap-3 p-3 rounded-2xl ring-1 ring-border/70 shadow-rest hover:shadow-hover hover:ring-brand-line transition-[box-shadow,--tw-ring-color] duration-200"
                >
                  <Avatar name={funding.borrowerName} photo={photos.get(funding.borrowerId)} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{funding.borrowerName}</div>
                    <div className="text-muted-foreground mt-0.5 text-xs">
                      <span className="whitespace-nowrap">
                        {funding.paidOn ? `Paid ${formatListDate(funding.paidOn)}` : 'Paid'}
                      </span>{' '}
                      · <span className="whitespace-nowrap">{describeTerm(funding.termDays)}</span>
                    </div>
                    <div className="text-muted-foreground text-xs">
                      {/* Each phrase kept whole, so a narrow screen breaks the
                          line at the "+" and never between a figure and its word. */}
                      <span className="whitespace-nowrap">
                        <Money amount={funding.principal} variant="display" className="text-foreground/80" /> capital +
                      </span>{' '}
                      <span className="whitespace-nowrap">
                        earned <Money amount={funding.earnings} variant="display" className="text-foreground/80" />
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Money
                      amount={centavos(funding.principal + funding.earnings)}
                      variant="display"
                      className="text-sm font-semibold"
                    />
                    <LoanStatusBadge state={funding.state} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}

        <Pager
          page={paging.paid}
          total={lender.settled.length}
          noun="loans"
          href={href('paid', 'paid-back')}
        />
      </Retractable>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold tracking-tight">Record money in or out</h2>
        </div>

        <TransactionForm lenderId={lender.id} today={todayForInput()} />
      </section>

      {/* ONE HISTORY, NOT TWO LISTS. "Money in" and "Withdrawal history" used
          to stand apart, and neither could say where this pot's money went
          between them: a repayment arriving and being lent straight out again
          appeared in neither. Since 2026-09-28 every move of the floating money
          is one line here, newest first, with the balance it left — deposits
          and withdrawals (still tapped to edit), loans going out, repayments
          and weekly interest coming back, and on the Admin pot the cut. */}
      <CapitalSection lender={lender} />

      <section id="money-history" className="scroll-mt-4 space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-base font-semibold tracking-tight">Money history</h2>
          <p className="text-muted-foreground text-xs">
            Floating now <Money amount={position.floating} variant="display" />
          </p>
        </div>

        <HistoryFilter lenderId={lender.id} query={query} active={historyFilter} />

        <MoneyHistoryList
          filtered={historyFilter !== null}
          events={filterHistory(lender.moneyHistory, historyFilter)}
          transactions={lender.transactions}
          page={paging.history}
          href={href('history', 'money-history')}
        />
      </section>
    </div>
  )
}

/**
 * One run of the Admin's cut: running or repaid.
 *
 * EVERY ROW NAMES BOTH PEOPLE, and it has to. The cut was charged on one
 * lender's capital inside one borrower's loan, and a row naming only the
 * borrower cannot be told apart from the row beside it when the same loan was
 * funded by two people. So the borrower is the heading and the lender is the
 * line under it, because "whose loan" is how the rest of this page is indexed.
 *
 * The total in the corner is handed in rather than added up here: it is the very
 * figure in the tile above, so a sum computed to REPLACE it would be a second
 * opinion about it.
 *
 * The rows no longer add to it by construction, and since 2026-09-25 this does
 * sum them — to print the difference, never to replace the total. On a loan
 * collecting its interest weekly the header counts only the weeks still owed
 * while each row carries its loan's whole cut, so the column comes to more. That
 * gap is said out loud below rather than left for the Admin to find.
 */
function CutList({
  id,
  title,
  rows,
  total,
  empty,
  page: at,
  href,
  photos,
  retractable = false,
  open = false,
}: {
  photos: Map<string, string>
  /** Folded shut until tapped, and open again while paging through it. */
  retractable?: boolean
  /** Start unfolded anyway — when "Cut coming" on the pie sent the Admin here. */
  open?: boolean
  id: string
  title: string
  rows: LenderDetail['adminCuts']['running']
  total: Centavos
  empty: string
  page: number
  href: (page: number) => string
}) {
  /**
   * WHAT THE ROWS ADD UP TO, WHICH IS NOT ALWAYS THE HEADER FIGURE.
   *
   * Each row carries the WHOLE cut its loan will pay. The header on the running
   * list is position.adminCutPending, which since 2026-09-25 counts only the
   * weeks NOT yet collected: a loan collecting its interest weekly has already
   * handed part of its cut over, and that part is in Earned above rather than
   * still to come. So on such a loan the rows total MORE than the header.
   *
   * Printed rather than hidden. This screen already exists to print the cut that
   * belongs to none of the loans listed on it; a header that does not match the
   * column beneath it is the same problem and gets the same answer. Summed over
   * every row, not the page, so paging does not change the sentence.
   */
  const rowsTotal = rows.reduce((sum, row) => sum + row.cut, 0)
  const collected = rowsTotal - total

  const header = (
    <>
      <h3 className="text-sm font-medium">{title}</h3>
      {rows.length > 0 ? (
        <p className="text-muted-foreground text-xs">
          <Money amount={total} variant="display" /> across{' '}
          {rows.length === 1 ? '1 loan' : `${rows.length} shares`}
        </p>
      ) : null}
    </>
  )

  const body = (
    <>

      {rows.length > 0 && collected > 0 ? (
        <p className="text-muted-foreground text-xs">
          The rows below add up to <Money amount={centavos(rowsTotal)} variant="display" />, because{' '}
          <Money amount={centavos(collected)} variant="display" /> of it has already been collected
          week by week and is counted in Earned above.
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p className="text-muted-foreground bg-card/60 border-border rounded-2xl border border-dashed p-4 text-center text-sm">
          {empty}
        </p>
      ) : (
        <ul className="bg-card divide-border/70 shadow-rest ring-border/70 divide-y overflow-hidden rounded-2xl ring-1">
          {pageOf(rows, at).map((row) => (
            <li key={`${row.loanId}-${row.lenderName}`}>
              <Link
                href={`/loans/${row.loanId}`}
                className="hover:bg-muted/40 flex items-center gap-3 p-3 transition-colors duration-150"
              >
                <Avatar name={row.borrowerName} photo={photos.get(row.borrowerId)} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{row.borrowerName}</div>
                  <div className="text-muted-foreground mt-0.5 text-xs">
                    <span className="whitespace-nowrap">
                      {row.paidOn ? `Paid ${formatListDate(row.paidOn)}` : row.reminderOn ? `Reminder ${formatListDate(row.reminderOn)}` : `Due ${formatListDate(row.dueOn)}`}
                    </span>{' '}
                    · <span className="whitespace-nowrap">{describeTerm(row.termDays)}</span>
                  </div>
                  <div className="text-muted-foreground truncate text-xs">on {row.lenderName}&rsquo;s money</div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Money amount={row.cut} variant="display" className="text-sm font-semibold" />
                  <LoanStatusBadge state={row.state} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Pager page={at} total={rows.length} noun="shares" href={href} />
    </>
  )

  return retractable ? (
    <Retractable id={id} open={open || at > 1} header={header} gap="space-y-2">
      {body}
    </Retractable>
  ) : (
    <div id={id} className="scroll-mt-4 space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-3">{header}</div>
      {body}
    </div>
  )
}

/**
 * A list that folds shut behind its heading — a long track record stays one
 * tap away instead of pushing everything under it down the page.
 *
 * A plain <details>, so it works without JavaScript and needs no client
 * component. `open` keeps it unfolded while the reader pages through it: the
 * pager reloads the page, and a list that snapped shut on every "Next" would
 * hide the very rows just asked for.
 */
function Retractable({
  id,
  open,
  header,
  gap = 'space-y-3',
  children,
}: {
  id: string
  open: boolean
  header: ReactNode
  gap?: string
  children: ReactNode
}) {
  return (
    <details id={id} open={open} className={`group scroll-mt-4 ${gap}`}>
      <summary className="flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
        <ChevronDown
          className="text-muted-foreground size-4 shrink-0 -rotate-90 transition-transform duration-150 group-open:rotate-0"
          aria-hidden
        />
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-3">{header}</div>
      </summary>
      {children}
    </details>
  )
}

/**
 * The money history: one row per move of this pot's floating money.
 *
 * A deposit or withdrawal keeps its edit layer, exactly as the old two lists
 * had it — the row IS that record. Anything to do with a loan opens the loan.
 * The figure under each amount is the floating balance that move left behind,
 * so reading down the list shows the pot filling and emptying.
 */
function MoneyHistoryList({
  events,
  transactions,
  page: at,
  href,
  filtered,
}: {
  /** A filter is on: an empty list then means "none of this kind", not "nothing at all". */
  filtered: boolean
  events: LenderDetail['moneyHistory']
  transactions: LenderDetail['transactions']
  page: number
  href: (page: number) => string
}) {
  if (events.length === 0) {
    return (
      <div className="bg-card/60 border-border rounded-2xl border border-dashed p-8 text-center">
        <HandCoins className="text-muted-foreground mx-auto size-6" aria-hidden />
        <p className="text-muted-foreground mx-auto mt-2 max-w-xs text-sm">
          {filtered ? 'Nothing of this kind yet.' : 'No money has moved in this pot yet.'}
        </p>
      </div>
    )
  }

  // The stored rows, for the edit dialog, which wants them as they came from
  // the database rather than as the history re-dated them.
  const byId = new Map(transactions.map((entry) => [entry.id, entry]))

  return (
    <>
      <ul className="bg-card divide-border/70 shadow-rest ring-border/70 divide-y overflow-hidden rounded-2xl ring-1">
        {pageOf(events, at).map((event) => {
          const incoming = event.amount >= 0
          const Icon = incoming ? ArrowDownLeft : ArrowUpRight
          const entry = event.move ? byId.get(event.move.id) : undefined

          const body = (
            <>
              <span className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-full">
                <Icon className="size-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                {/* WRAPS, not truncated. The amount column beside it is wide
                    on a phone, and "Lent to Rico Mend…" hid the one word the
                    line exists to say. */}
                <div className="text-sm font-medium break-words">{event.title}</div>
                <div className="text-muted-foreground mt-0.5 text-xs">{formatListDate(event.on)}</div>
                {event.detail === null ? null : event.move ? (
                  // THE ADMIN'S OWN NOTE, typed on a money in or out. Free text of
                  // any length, so it wraps like text and stops at two lines; the
                  // whole note shows by holding the row (HoldNoteRow), or in the edit
                  // dialog a tap opens.
                  // It used to go through the nowrap branch below, and a long note
                  // ran out of its column and under the amounts.
                  <div className="text-muted-foreground line-clamp-2 text-xs break-words" title={event.detail}>
                    {event.detail}
                  </div>
                ) : (
                  <div className="text-muted-foreground text-xs break-words">
                    {/* "₱30,000.00 capital + ₱12,000.00 interest" breaks at the
                        "+", never inside a phrase. Only for these breakdowns the
                        app writes itself, which are short by construction. */}
                    {event.detail.split(' + ').map((part, index, parts) => (
                      <span key={index}>
                        {index > 0 ? ' ' : null}
                        {/* The "+" rides at the end of the phrase before it, so
                            it never sits alone on a line. */}
                        <span className="whitespace-nowrap">
                          {part}
                          {index < parts.length - 1 ? ' +' : null}
                        </span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex shrink-0 flex-col items-end">
                <Money amount={event.amount} variant="display" className="text-sm font-semibold" muted={!incoming} />
                <span className="text-muted-foreground text-xs">
                  <Money amount={event.balance} variant="display" /> floating
                </span>
              </div>
            </>
          )

          if (entry) {
            return (
              /* RELATIVE, because the edit trigger is a layer over the whole row
                 rather than a button at the end of it — see EditTransaction. */
              <HoldNoteRow
                key={event.key}
                note={entry.note}
                className="hover:bg-muted/40 relative flex items-center gap-3 p-3 transition-colors duration-150"
              >
                <EditTransaction
                  entry={{
                    id: entry.id,
                    type: entry.type,
                    amount: entry.amount,
                    occurredOn: entry.occurredOn,
                    note: entry.note,
                    advance: entry.against !== null,
                  }}
                />
                {body}
                <ChevronRight className="text-muted-foreground size-4 shrink-0" aria-hidden />
              </HoldNoteRow>
            )
          }

          return (
            <li key={event.key}>
              <Link
                href={event.loanId ? `/loans/${event.loanId}` : '#money-history'}
                className="hover:bg-muted/40 flex items-center gap-3 p-3 transition-colors duration-150"
              >
                {body}
                <ChevronRight className="text-muted-foreground size-4 shrink-0" aria-hidden />
              </Link>
            </li>
          )
        })}
      </ul>

      <Pager page={at} total={events.length} noun="moves" href={href} />
    </>
  )
}

/**
 * The Money history filter: All · Money in · Withdrawals · Lent out · Paid back.
 *
 * Links, not buttons, so the choice lives in the URL (`show`) like the page
 * numbers do, works without JavaScript, and survives a refresh. Changing it
 * goes back to the first page of the list.
 */
function HistoryFilter({
  lenderId,
  query,
  active,
}: {
  lenderId: string
  query: Record<string, string | string[] | undefined>
  active: HistoryFilterKey | null
}) {
  const hrefFor = (key: HistoryFilterKey | null) => {
    const params = new URLSearchParams()
    for (const [name, value] of Object.entries(query)) {
      const first = Array.isArray(value) ? value[0] : value
      if (first && name !== 'show' && name !== 'history') params.set(name, first)
    }
    if (key) params.set('show', key)
    const search = params.toString()
    return `/lenders/${lenderId}${search ? `?${search}` : ''}#money-history`
  }
  const options = [{ key: null, label: 'All' }, ...HISTORY_FILTERS.map(({ key, label }) => ({ key, label }))]

  return (
    <nav aria-label="Show in money history" className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:px-0">
      <ul className="flex w-max gap-1.5">
        {options.map((option) => {
          const current = option.key === active
          return (
            <li key={option.label}>
              <Link
                href={hrefFor(option.key)}
                scroll={false}
                aria-current={current ? 'true' : undefined}
                className={cn(
                  'flex h-9 items-center rounded-full border px-3.5 text-[13px] font-medium whitespace-nowrap transition-colors pointer-fine:h-8',
                  current
                    ? 'bg-brand-bg ring-brand-line text-foreground border-transparent ring-1'
                    : 'border-input text-muted-foreground hover:text-foreground hover:bg-muted/50',
                )}
              >
                {option.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

/**
 * Starting capital, with every version of it the Admin has saved, newest first.
 * The newest is the figure in force. Saving a new one moves no money.
 */
function CapitalSection({ lender }: { lender: LenderDetail }) {
  return (
    <section id="starting-capital" className="scroll-mt-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Starting capital</h2>
          <p className="text-muted-foreground text-xs">
            Now{' '}
            {lender.startingCapital === 0 ? 'not set' : <Money amount={lender.startingCapital} variant="display" />}.
            Changing it moves no money.
          </p>
        </div>
        <ChangeCapitalForm lenderId={lender.id} current={lender.startingCapital} />
      </div>

      {lender.capitalVersions.length === 0 ? null : (
        <ul className="bg-card divide-border/70 shadow-rest ring-border/70 divide-y overflow-hidden rounded-2xl ring-1">
          {lender.capitalVersions.map((version, index) => (
            <HoldNoteRow key={version.id} note={version.note} className="flex items-center gap-3 p-3">
              <span className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-full">
                <History className="size-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{index === 0 ? 'Current' : 'Earlier'}</div>
                <div className="text-muted-foreground mt-0.5 text-xs">Saved {formatListDate(version.savedAt)}</div>
                {version.note ? (
                  <div className="text-muted-foreground line-clamp-2 text-xs break-words" title={version.note}>
                    {version.note}
                  </div>
                ) : null}
              </div>
              {version.amount === 0 ? (
                <span className="text-muted-foreground text-sm">Not set</span>
              ) : (
                <Money
                  amount={version.amount}
                  variant="display"
                  className="text-sm font-semibold"
                  muted={index !== 0}
                />
              )}
            </HoldNoteRow>
          ))}
        </ul>
      )}
    </section>
  )
}

const onDay = new Intl.DateTimeFormat('en-PH', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })

/**
 * "How much will this pot have on <day>?" — a date box under Floating, and the
 * answer with what makes it up.
 *
 * WHAT THE FIGURE IS: projectedFloating (server/lenders/queries.ts) over
 * lib/money/projection.ts. Today's Floating plus every payment scheduled to
 * reach this pot from today through the chosen day, if borrowers pay on time:
 * capital and this pot's interest, and on the Admin pot the Admin cut on other
 * lenders' loans. Money already late is NOT counted and is said so underneath.
 * No new loans, deposits or withdrawals are imagined.
 *
 * A GET form like the period bar above it: the day is in the URL, every other
 * key on the page (period, page numbers) rides along as a hidden input.
 */
function FloatingOnDate({
  lenderId,
  isSelf,
  query,
  today,
  raw,
  on,
  projection,
}: {
  lenderId: string
  isSelf: boolean
  query: Record<string, string | string[] | undefined>
  today: Date
  raw: string
  on: Date | null
  projection: Projection | null
}) {
  const keep = Object.entries(query).flatMap(([key, value]) =>
    key === 'on' || value === undefined ? [] : [[key, Array.isArray(value) ? (value[0] ?? '') : value] as const],
  )
  const presetHref = (days: number) => {
    const params = new URLSearchParams(keep.map(([k, v]) => [k, v]))
    params.set('on', toDateInput(addDays(today, days)))
    return `/lenders/${lenderId}?${params.toString()}#available-on`
  }
  const presets = [
    { days: 7, label: 'In 1 week' },
    { days: 14, label: '2 weeks' },
    { days: 30, label: '30 days' },
  ]

  return (
    <section id="available-on" className="bg-card ring-border/70 shadow-rest scroll-mt-4 space-y-3 rounded-2xl p-4 ring-1">
      <div>
        <h2 className="text-base font-semibold tracking-tight">Available on a date</h2>
        <p className="text-muted-foreground text-xs">What Floating will be on a day you pick, if borrowers pay on time.</p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {presets.map((preset) => {
          const active = on !== null && toDateInput(addDays(today, preset.days)) === toDateInput(on)
          return (
            <Link
              key={preset.days}
              href={presetHref(preset.days)}
              aria-current={active ? 'true' : undefined}
              className={cn(
                'inline-flex min-h-9 items-center rounded-full px-3 text-[0.8rem] font-medium transition-colors',
                'focus-visible:ring-ring/50 outline-none focus-visible:ring-3',
                active
                  ? 'bg-foreground text-background'
                  : 'bg-background text-muted-foreground ring-border/70 hover:text-foreground ring-1 hover:bg-muted',
              )}
            >
              {preset.label}
            </Link>
          )
        })}
      </div>

      <form method="get" action={`/lenders/${lenderId}#available-on`} className="flex items-end gap-2">
        {keep.map(([key, value]) => (
          <input key={key} type="hidden" name={key} value={value} />
        ))}
        <div className="min-w-0 flex-1 space-y-1 sm:max-w-48">
          <Label htmlFor="available-on-date" className="text-muted-foreground text-xs">
            Or pick a day
          </Label>
          <Input id="available-on-date" name="on" type="date" min={toDateInput(today)} defaultValue={raw} required />
        </div>
        <Button type="submit" variant="secondary">
          Check
        </Button>
      </form>

      {raw !== '' && !projection ? (
        <p className="text-muted-foreground text-xs">Pick today or a later day. What the pot held before today is in the money history below.</p>
      ) : null}

      {projection && on ? (
        <div className="bg-muted/40 space-y-3 rounded-xl p-3">
          <div>
            <div className="text-muted-foreground text-xs">On {onDay.format(on)}</div>
            <Money amount={projection.projected} variant="display" className="text-2xl font-semibold tracking-tight" />
          </div>

          {/* The sum, line by line, so it can be checked by eye: the rows add
              up to the figure above. */}
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Floating today</dt>
            <dd className="text-right"><Money amount={projection.floatingNow} variant="display" /></dd>
            <dt className="text-muted-foreground">+ Capital coming back</dt>
            <dd className="text-right"><Money amount={projection.capital} variant="display" /></dd>
            <dt className="text-muted-foreground">+ Interest</dt>
            <dd className="text-right"><Money amount={projection.interest} variant="display" /></dd>
            {isSelf ? (
              <>
                <dt className="text-muted-foreground">+ Admin cuts from other lenders</dt>
                <dd className="text-right"><Money amount={projection.adminCuts} variant="display" /></dd>
              </>
            ) : null}
          </dl>

          {projection.late > 0 ? (
            <p className="text-status-warning text-xs">
              Not counted: <Money amount={projection.late} variant="display" /> that is already late. It is added the day it is paid.
            </p>
          ) : null}

          {projection.arrivals.length > 0 ? (
            <details className="group">
              <summary className="text-brand cursor-pointer text-xs font-medium">
                {projection.arrivals.length === 1 ? 'From 1 payment' : `From ${projection.arrivals.length} payments`}
              </summary>
              <ul className="divide-border/70 mt-2 divide-y text-sm">
                {projection.arrivals.map((arrival) => (
                  <li key={`${arrival.loanId}-${arrival.on.getTime()}`} className="flex items-baseline justify-between gap-3 py-1.5">
                    <span className="min-w-0">
                      <span className="block truncate">{arrival.borrowerName}</span>
                      <span className="text-muted-foreground text-xs">
                        {formatListDate(arrival.on)}
                        {arrival.capital > 0 ? ' · capital + interest' : arrival.interest > 0 ? ' · interest' : ' · Admin cut'}
                      </span>
                    </span>
                    <Money
                      amount={centavos(arrival.capital + arrival.interest + arrival.adminCut)}
                      variant="display"
                      className="shrink-0"
                    />
                  </li>
                ))}
              </ul>
            </details>
          ) : (
            <p className="text-muted-foreground text-xs">Nothing is due back to this pot by then.</p>
          )}
        </div>
      ) : null}
    </section>
  )
}
