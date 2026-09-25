import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowDownLeft, ArrowLeft, ArrowUpRight, CalendarRange, ChevronRight, HandCoins, Scissors, TrendingUp, Wallet } from 'lucide-react'

import { StackedColumns } from '@/components/chart.tsx'
import { LoanStatusBadge } from '@/components/loan-status.tsx'
import { Avatar } from '@/components/avatar.tsx'
import { Money } from '@/components/money.tsx'
import { Pager } from '@/components/pager.tsx'
import { IconChip, StatRow, StatTile } from '@/components/stat-tile.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { type Centavos, centavos, formatPesos } from '@/lib/money/centavos.ts'
import { describeTerm } from '@/lib/money/weeks.ts'
import { PAGE_SIZE, pagedHref, parsePage } from '@/lib/pagination.ts'
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
import { type LenderDetail, getLender } from '@/server/lenders/queries.ts'

import { LenderSettings } from './lender-settings.tsx'
import { EditTransaction, TransactionForm } from './transaction-form.tsx'

const dateFormat = new Intl.DateTimeFormat('en-PH', { day: 'numeric', month: 'short', year: 'numeric' })

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

  const lender = await getLender(user.id, (await params).id, range)
  if (!lender) notFound()

  const { position } = lender
  const deposits = lender.transactions.filter((entry) => entry.type === 'DEPOSIT')
  const withdrawals = lender.transactions.filter((entry) => entry.type === 'WITHDRAWAL')
  const settledEarnings = centavos(lender.settled.reduce((total, row) => total + row.earnings, 0))

  /* WHAT THE "Out with" ROWS EARN, added up. `lender.fundings` is every funding
     row of this pot on a loan not yet repaid, and this is the "earns" figure
     printed on each of those rows totalled — SUM("earningsCentavos") over the
     same rows, checked against the database on 2026-09-25.

     INTEREST, NOT CAPITAL, because the capital is already the "Out on loan"
     tile a few inches above and a corner repeating it says nothing new. What
     the page could not say before is what all that lending is due to make.

     NOT THE SAME AS THE "Interest to collect" TILE on the Admin pot, and
     deliberately so: that figure also carries the 2% cut charged on other
     lenders' capital, which belongs to none of the rows below. On every other
     lender the two are equal. The breakdown section above itemises the
     difference on the one pot that has any.

     Paged lists, whole-list sums: this counts every row, not the ten on screen. */
  const outEarnings = centavos(lender.fundings.reduce((total, row) => total + row.earnings, 0))

  /* SIX LISTS, SIX PAGE NUMBERS. Every list on this page is capped at ten rows,
     each with its own key in the query string, so paging the withdrawals does
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
    in: parsePage(query.in).page,
    withdrawn: parsePage(query.withdrawn).page,
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
            startingCapital={lender.startingCapital}
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

      <EarnedOverPeriod
        lenderId={lender.id}
        amount={lender.rangeInterest}
        range={lender.range}
        isSelf={lender.isSelf}
        paging={paging}
      />

      {/* `pending` is the interest on loans still running. The cut belongs to
          NONE of the "Out with" or "Paid back" rows further down this page —
          those list only loans this pot's own capital went into — so a tile
          carrying a cut sat higher than the rows beneath it with nothing on the
          page to account for the difference. On the admin pot the breakdown
          section below itemises every peso of it; on every other lender both cut
          figures are 0 and the section is not rendered at all. `adminCutEarned`
          / `adminCutPending` are exactly the SUM("adminCutCentavos") slices of
          the same two totals, split in lenderPosition.

          THIS TILE USED TO READ "Total interest" AND SHOW earned + pending. The
          words were true of that sum, but the tile overlapped "Earned" beside it
          — earned was a part of it, not a second amount — and the admin read the
          two as figures to subtract. Changed 2026-09-25 to show `pending` alone
          under "Interest to collect", so each tile names a separate pot of money
          and nothing on the row is counted twice.

          "to collect" IS A PROMISE ABOUT WHICH LOANS. `pending` is the interest
          on loans NOT yet marked paid, deleted loans excluded, scoped to this
          user: this pot's own share, plus — on the admin pot only — the cut
          charged on other funders' capital. On a weekly loan the weeks already
          collected are OUT of it, because that money is in hand and sits in
          `earned` instead. So nothing in this figure has been collected, which
          is what the label says. Proven against the database on 2026-09-25 by
          summing "earningsCentavos" over non-archived, non-PAID funding rows
          plus the "adminCutCentavos" slices on other funders' rows: the query
          and the tile agreed on all three live pots, admin pot included.

          It is an expectation, not cash, and it is NEVER in Floating. A loan
          already overdue is still counted here at its full value, because this
          ledger has no way to write one off.

          THERE IS NO LONGER AN "Earned" TILE ON THIS ROW. It showed
          `position.earned` — every peso of profit ever received — and the
          reconciliation record had it marked **Label lies** on the Admin pot,
          where the figure silently carried the cut taken on other lenders'
          capital. It was replaced on 2026-09-25 by the earned-over-a-period card
          ABOVE this row, which answers the question the admin was actually
          asking of it: what did this pot make in a given month. It is not on this
          row because it is not a position figure and must not be added to these
          three. `position.earned` is still on the lenders LIST, and the "Paid
          back" heading further down still prints this pot's own settled earnings. */}
      {/* POT TOTAL IS NOT THE OTHER TILES ADDED UP, and it must not be, because
          `earned` is already inside `floating` — a repayment puts capital and
          profit straight back — so adding all four figures counts it twice and
          lands on an amount that is nobody's money.

          The sum that is true is floating + out on loan + interest to collect,
          which is `deposits - withdrawals + earned + pending` with the
          principal cancelling out. Verified that way against the database on
          2026-09-23: the two expressions agreed on all eight live lenders,
          including the Admin pot, where `earned` and `pending` each carry the
          2% cut on other funders' capital.

          IT IS NOT THIS ROW ADDED UP. Since "Starting capital" joined the row it
          is not any three of these four either — that tile is a figure the Admin
          typed and is in none of these sums. What the two of them DO say when
          read together is what the lending has made this person: Pot total minus
          Starting capital. That subtraction is the reason the figure was asked
          for, it is sound, and it is the only arithmetic across this row that is.

          Read forwards, it is what Floating BECOMES once every running loan is
          repaid and nothing further is put in or taken out. That is the bound
          and the note says it: a loan already overdue is still counted here at
          its full value, because this ledger has no way to write one off. It is
          an expectation, not cash, which is why Floating stays the hero above. */}
      <StatRow className="sm:grid-cols-2 xl:grid-cols-4">
        {/* READ STRAIGHT OFF Lender.startingCapitalCentavos. The Admin typed it;
            nothing in this app computes it, maintains it or checks it, and NO
            QUERY CAN PROVE IT — which is the honest position, not a gap. The
            deposit rows on this account were entered loan by loan after the fact,
            so deposits minus withdrawals is the size of the lending and not the
            size of the stake. That is exactly why this is typed instead.

            IT IS IN NO OTHER FIGURE ON THIS PAGE. Not in Floating, not in Pot
            total, not in the chart, not in any report. Saving it moves no money.
            `lenderPosition` does not read the column at all, so there is no path
            by which it can shift a peso of the derived figures beside it.

            WHY IT SITS NEXT TO "Pot total": the difference between the two is
            what the lending has made this person, which is the question the
            figure was asked for — the interest compounds as the money goes round,
            and without a fixed starting point there is nothing to compare the pot
            against. Both tiles carry notes, because that subtraction is only
            sound if the reader knows one is a statement and the other a sum.

            Zero renders "Not set" rather than ₱0.00: ₱0.00 claims they put in
            nothing, and 0 only means nobody has said yet. */}
        <StatTile
          label="Starting capital"
          value={
            lender.startingCapital === 0 ? (
              <span className="text-muted-foreground">Not set</span>
            ) : (
              <Money amount={lender.startingCapital} variant="display" />
            )
          }
          note={
            lender.startingCapital === 0
              ? 'the Admin has not said what this pot started with'
              : 'put in to start, typed by the Admin before any interest'
          }
        />
        <StatTile
          label="Pot total"
          value={
            <Money
              amount={centavos(position.floating + position.outOnLoan + position.pending)}
              variant="display"
            />
          }
          note="once every running loan is paid in full"
        />
        <StatTile label="Out on loan" value={<Money amount={position.outOnLoan} variant="display" />} />
        <StatTile
          label="Interest to collect"
          value={<Money amount={position.pending} variant="display" muted={position.pending === 0} />}
          note={
            position.pending === 0
              ? 'nothing is owed to this pot'
              : position.adminCutPending > 0
                ? `on loans still running, includes ${formatPesos(position.adminCutPending)} cut from other lenders' loans`
                : 'on loans still running, not in the pot yet'
          }
        />
      </StatRow>

      {/* WHERE THE CUT COMES FROM. The two tiles above carry money that belongs
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
            href={href('cutsOut', 'cuts-running')}
          />
          <CutList
            id="cuts-repaid"
            title="On loans repaid"
            rows={lender.adminCuts.settled}
            total={position.adminCutEarned}
            empty="No loan funded by anyone else has been repaid yet."
            page={paging.cutsPaid}
            href={href('cutsPaid', 'cuts-repaid')}
          />
        </section>
      ) : null}

      {/* THE POT OVER TIME, which is the one thing the figures above cannot say.
          They are all as of today: they tell the admin where the money is, and
          nothing at all about whether this pot has been growing or sitting
          still.

          Each column is the pot as it stood at the end of that month, rebuilt
          from the movements. The last one is as of TODAY rather than the end of
          this month, so it is not a projection.

          IT COUNTS A LOAN FROM ITS START DATE. "Out on loan" above counts it
          from the moment it was recorded, so a loan dated to start next week is
          in the tile and not yet in the columns. That is the honest order for a
          history, and because the two sit inches apart the difference is
          printed underneath rather than left to be noticed. */}
      <section className="bg-card space-y-3 rounded-2xl p-4 ring-1 ring-border/70 shadow-rest">
        <div className="flex items-start gap-3">
          <IconChip icon={TrendingUp} tint="violet" />
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight">The last twelve months</h2>
            <p className="text-muted-foreground mt-0.5 text-sm">
              What this pot was worth at each month end, and how much of it was working.
            </p>
          </div>
        </div>

        <StackedColumns
          columns={lender.history.map((month) => ({
            label: month.label,
            base: month.outOnLoan,
            top: month.floating,
          }))}
          series={[{ label: 'Out on loan' }, { label: 'Floating' }]}
        />

        {lender.notYetStarted > 0 ? (
          <p className="text-muted-foreground text-xs">
            <Money amount={lender.notYetStarted} variant="display" /> is committed to a loan dated to
            start later. It is counted in Out on loan above, and joins the columns on its start date.
          </p>
        ) : null}
      </section>

      <section id="out-with" className="scroll-mt-4 space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-base font-semibold tracking-tight">Out with</h2>
          {lender.fundings.length > 0 ? (
            <p className="text-muted-foreground text-xs">
              {lender.fundings.length === 1 ? '1 loan running' : `${lender.fundings.length} loans running`} ·{' '}
              earns <Money amount={outEarnings} variant="display" />
            </p>
          ) : null}
        </div>

        {lender.fundings.length === 0 ? (
          <p className="text-muted-foreground bg-card/60 border-border rounded-2xl border border-dashed p-6 text-center text-sm">
            None of this money is out on loan right now.
          </p>
        ) : (
          <ul className="space-y-2">
            {pageOf(lender.fundings, paging.out).map((funding) => (
              <li key={funding.loanId}>
                <Link
                  href={`/borrowers/${funding.borrowerId}`}
                  className="bg-card group flex items-center gap-3 p-3 rounded-2xl ring-1 ring-border/70 shadow-rest hover:shadow-hover hover:ring-brand-line transition-[box-shadow,--tw-ring-color] duration-200"
                >
                  <Avatar name={funding.borrowerName} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{funding.borrowerName}</div>
                    <div className="text-muted-foreground mt-0.5 text-xs">
                      {describeTerm(funding.termDays)} · due {dateFormat.format(funding.dueOn)} ·
                      earns <Money amount={funding.earnings} variant="display" />
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Money amount={funding.principal} variant="display" className="text-sm font-semibold" />
                    <LoanStatusBadge state={funding.state} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}

        <Pager
          page={paging.out}
          total={lender.fundings.length}
          noun="loans"
          href={href('out', 'out-with')}
        />
      </section>

      {/* WHO HAS ALREADY PAID THIS POT BACK. "Out with" above is the money at
          risk; this is the track record beside it, and the two answer different
          questions. Kept forever, the same as on a borrower's own profile. */}
      <section id="paid-back" className="scroll-mt-4 space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-base font-semibold tracking-tight">Paid back</h2>
          {lender.settled.length > 0 ? (
            <p className="text-muted-foreground text-xs">
              {lender.settled.length === 1 ? '1 loan settled' : `${lender.settled.length} loans settled`} ·{' '}
              <Money amount={settledEarnings} variant="display" /> earned
            </p>
          ) : null}
        </div>

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
                  <Avatar name={funding.borrowerName} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{funding.borrowerName}</div>
                    <div className="text-muted-foreground mt-0.5 text-xs">
                      {describeTerm(funding.termDays)} ·{' '}
                      {funding.paidOn ? `paid ${dateFormat.format(funding.paidOn)}` : 'paid'} · earned{' '}
                      <Money amount={funding.earnings} variant="display" />
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Money amount={funding.principal} variant="display" className="text-sm font-semibold" />
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
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold tracking-tight">Record money in or out</h2>
        </div>

        <TransactionForm lenderId={lender.id} today={todayForInput()} />
      </section>

      {/* MONEY IN AND MONEY OUT ARE TWO LISTS, not one mixed one.
          They answer different questions — "what has this person put in" and
          "what have they taken back" — and the second is the one the admin is
          usually looking for, because it is the money that has left. In a single
          list a withdrawal was a minus sign among a dozen deposits. */}
      <section id="money-in" className="scroll-mt-4 space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-base font-semibold tracking-tight">Money in</h2>
          {deposits.length > 0 ? (
            <p className="text-muted-foreground text-xs">
              <Money amount={position.deposits} variant="display" /> over{' '}
              {deposits.length === 1 ? '1 deposit' : `${deposits.length} deposits`}
            </p>
          ) : null}
        </div>

        <TransactionList
          entries={deposits}
          empty="Nothing has been put into this pot yet."
          page={paging.in}
          noun="deposits"
          href={href('in', 'money-in')}
        />
      </section>

      <section id="withdrawals" className="scroll-mt-4 space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-base font-semibold tracking-tight">Withdrawal history</h2>
          {withdrawals.length > 0 ? (
            <p className="text-muted-foreground text-xs">
              <Money amount={position.withdrawals} variant="display" /> over{' '}
              {withdrawals.length === 1 ? '1 withdrawal' : `${withdrawals.length} withdrawals`}
            </p>
          ) : null}
        </div>

        <TransactionList
          entries={withdrawals}
          empty="Nothing has been taken back out of this pot."
          page={paging.withdrawn}
          noun="withdrawals"
          href={href('withdrawn', 'withdrawals')}
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
}: {
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

  return (
    <div id={id} className="scroll-mt-4 space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="text-sm font-medium">{title}</h3>
        {rows.length > 0 ? (
          <p className="text-muted-foreground text-xs">
            <Money amount={total} variant="display" /> across{' '}
            {rows.length === 1 ? '1 loan' : `${rows.length} shares`}
          </p>
        ) : null}
      </div>

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
                <Avatar name={row.borrowerName} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{row.borrowerName}</div>
                  <div className="text-muted-foreground mt-0.5 truncate text-xs">
                    on {row.lenderName}&rsquo;s money · {describeTerm(row.termDays)} ·{' '}
                    {row.paidOn
                      ? `paid ${dateFormat.format(row.paidOn)}`
                      : `due ${dateFormat.format(row.dueOn)}`}
                  </div>
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
    </div>
  )
}

/**
 * A run of movements, one way or the other.
 *
 * Money going out is shown NEGATIVE, not merely greyed. A colour and an icon are
 * easy to skim past; a minus sign in front of the figure is not — and on the
 * withdrawal list, where every row is an outgoing one, the sign is the only
 * thing carrying the direction at all.
 */
function TransactionList({
  entries,
  empty,
  page: at,
  noun,
  href,
}: {
  entries: LenderDetail['transactions']
  empty: string
  page: number
  noun: string
  href: (page: number) => string
}) {
  if (entries.length === 0) {
    return (
      <div className="bg-card/60 border-border rounded-2xl border border-dashed p-8 text-center">
        <HandCoins className="text-muted-foreground mx-auto size-6" aria-hidden />
        <p className="text-muted-foreground mx-auto mt-2 max-w-xs text-sm">{empty}</p>
      </div>
    )
  }

  return (
    <>
      <ul className="bg-card divide-border/70 shadow-rest ring-border/70 divide-y overflow-hidden rounded-2xl ring-1">
        {pageOf(entries, at).map((entry) => {
          const isDeposit = entry.type === 'DEPOSIT'
          const Icon = isDeposit ? ArrowDownLeft : ArrowUpRight
          return (
            /* RELATIVE, because the edit trigger is a layer over the whole row
               rather than a button at the end of it — see EditTransaction. */
            <li
              key={entry.id}
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
              <span className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-full">
                <Icon className="size-4" aria-hidden />
              </span>
              {/* AN ADVANCE SAYS SO. It is an ordinary withdrawal in every other
                  respect — same row, same effect on floating, same edit dialog —
                  but it was drawn against a loan that has not been repaid, and a
                  list that called it "Money out" like the rest would leave the
                  admin no way to tell which withdrawals are already spoken for. */}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {entry.against
                    ? `Advance on ${entry.against.borrowerName}’s loan`
                    : isDeposit
                      ? 'Money in'
                      : 'Money out'}
                </div>
                <div className="text-muted-foreground mt-0.5 truncate text-xs">
                  {dateFormat.format(entry.occurredOn)}
                  {entry.note ? ` · ${entry.note}` : ''}
                  {entry.against ? (
                    <>
                      {' · '}
                      {/* Lifted above the edit layer covering this row. Without
                          the z-index it is a link nothing can reach. */}
                      <Link
                        href={`/loans/${entry.against.loanId}`}
                        className="hover:text-foreground relative z-10 underline"
                      >
                        open the loan
                      </Link>
                    </>
                  ) : null}
                </div>
              </div>
              <Money
                amount={isDeposit ? entry.amount : centavos(-entry.amount)}
                variant="display"
                className="text-sm font-semibold"
                muted={!isDeposit}
              />
              <ChevronRight className="text-muted-foreground size-4 shrink-0" aria-hidden />
            </li>
          )
        })}
      </ul>

      <Pager page={at} total={entries.length} noun={noun} href={href} />
    </>
  )
}
