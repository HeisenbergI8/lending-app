import Link from 'next/link'
import { AlertTriangle, ChevronRight, HandCoins, PiggyBank, TrendingUp, Users, Wallet } from 'lucide-react'

import { Avatar } from '@/components/avatar.tsx'
import { BorrowerLabelBadge, TrackRecordLine } from '@/components/borrower-rating.tsx'
import { Money } from '@/components/money.tsx'
import { StatRow, StatTile } from '@/components/stat-tile.tsx'
import { centavos, formatPesos } from '@/lib/money/centavos.ts'
import { requireUser } from '@/server/auth/guard.ts'
import { borrowerCounts, topBorrowers } from '@/server/borrowers/queries.ts'
import { listLenders } from '@/server/lenders/queries.ts'
import { interestSummary, overdueSummary } from '@/server/loans/queries.ts'

export const metadata = { title: 'Dashboard · Consignment Kush' }

/** Borrowers shown on the home screen before it stops being a glance. The rest are one tap away. */
const SHOWN = 6

/**
 * The opening screen: the four figures from the spec, the pots across the top,
 * the people below.
 *
 * Every number here is DERIVED from the same queries the lender and borrower
 * screens use, never from a separate dashboard aggregate. A second way of
 * summing the same money is a second answer waiting to disagree with the first,
 * and the admin would have no way to tell which of the two was lying.
 */
export default async function DashboardPage() {
  const user = await requireUser()

  const [lenders, borrowers, people, overdue, interest] = await Promise.all([
    listLenders(user.id),
    // The six shown, ranked by what they owe, chosen by Postgres. This screen
    // used to load EVERY borrower with EVERY loan and payment and sort them in
    // JavaScript to keep six — the heaviest query in the app, on the screen
    // that opens most often.
    topBorrowers(user.id, SHOWN),
    borrowerCounts(user.id),
    // Three aggregates, no loan rows. This screen renders not one overdue loan
    // — it shows a count, a sum and how many PEOPLE are late — so fetching them
    // to add up in JavaScript was work whose only output was three numbers.
    overdueSummary(user.id),
    // Two aggregates over Loan.interestCentavos. Not summed from the funding
    // rows: the schema's rate invariant means both routes give the same figure,
    // and the loan is the shorter one.
    interestSummary(user.id),
  ])

  const pots = lenders.reduce(
    (sum, lender) => ({
      floating: sum.floating + lender.position.floating,
      out: sum.out + lender.position.outOnLoan,
    }),
    { floating: 0, out: 0 },
  )

  // The admin is a lender row with isSelf — their earnings are their own cut on
  // other people's money plus what their own capital made, already added up by
  // lenderPosition. There is no separate admin ledger to reconcile.
  const self = lenders.find((lender) => lender.isSelf)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[1.75rem] font-semibold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-0.5 text-sm">
          Everything the Admin has lent, at a glance.
        </p>
      </div>

      {/* Exactly ONE hero. More than one and the eye has nowhere to land, which
          is the whole job of a headline number. It sits above the row rather
          than inside it — see StatRow. */}
      <StatTile
        hero
        icon={HandCoins}
        label="Out on loan"
        value={<Money amount={centavos(pots.out)} variant="display" />}
        /* People with at least one unpaid loan, across everyone — not the six
           listed below, and not a count of loans. */
        note={
          people.owing === 1 ? 'in one borrower’s hands' : `in ${people.owing} borrowers’ hands`
        }
      />

      <StatRow>
        <StatTile
          label="Floating"
          icon={PiggyBank}
          tint="mint"
          value={<Money amount={centavos(pots.floating)} variant="display" />}
          note="idle, ready to lend"
        />
        <Link href="/loans?status=overdue" className="block">
          <StatTile
            label="Overdue"
            icon={AlertTriangle}
            tone={overdue.borrowers > 0 ? 'critical' : undefined}
            /* PEOPLE, not loans — the spec asks how many BORROWERS are
               overdue, and one person late on two loans is one person to
               chase. `overdue.borrowers` is a COUNT(DISTINCT borrowerId) done
               in Postgres; the note underneath is the loan count and the sum
               over the same rows, so the two describe one set. */
            value={String(overdue.borrowers)}
            note={
              overdue.borrowers > 0
                ? `${overdue.loans === 1 ? '1 loan' : `${overdue.loans} loans`} · ${formatPesos(overdue.total)} unpaid`
                : 'nobody late'
            }
            className="h-full"
          />
        </Link>
        <StatTile
          label="Admin earnings"
          icon={Wallet}
          tint="violet"
          value={<Money amount={self?.position.earned ?? centavos(0)} variant="display" />}
          note={
            self && self.position.pending > 0
              ? `${formatPesos(self.position.pending)} still to come`
              : 'already back with the Admin'
          }
        />
        {/* INTEREST CHARGED, NOT INTEREST KEPT, and the two are far apart. This
            is the whole 7% on every loan on record — the funding lenders' 5%
            and the Admin's 2% together — where the tile beside it is only the
            Admin's share. Labelled "Total interest" and noted as to date,
            because it is every loan ever, not this month: a range belongs on
            the reports screen, which has the dates for it. Deleted loans are
            out, and a repayment that was undone stops counting as collected.

            WHAT "back" COUNTS WIDENED ON 2026-09-25. It used to be the interest
            on loans with a settling payment, and nothing else could put interest
            in anybody's hands. It is now that PLUS the weeks already collected
            on loans that are still running — which is money that really is back,
            so the word holds. Had it not been widened, this note would have
            contradicted the Floating tile three tiles to its left, which counts
            those same weeks.

            "charged" is untouched: SUM("interestCentavos") over live loans, the
            whole 7% whenever the loan was made.

            Measured 2026-09-25: no loan collects weekly yet, so "back" equals
            the interest on settled loans exactly as before. */}
        <StatTile
          label="Total interest"
          icon={TrendingUp}
          tint="amber"
          value={<Money amount={interest.charged} variant="display" />}
          note={
            interest.charged === 0
              ? 'no loans on record yet'
              : `to date · ${formatPesos(interest.collected)} back, ${formatPesos(interest.pending)} still out`
          }
        />
      </StatRow>

      {/* LENDERS ACROSS THE TOP, per the spec's main screen — the admin's own pot
          included, because it is a lender row like any other. */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold tracking-tight">Pots</h2>
          <Link href="/lenders" className="text-brand hover:text-brand-strong -my-2 inline-flex min-h-11 items-center py-2 text-xs font-medium pointer-fine:my-0 pointer-fine:min-h-0 pointer-fine:py-0">
            All lenders
          </Link>
        </div>

        {lenders.length === 0 ? (
          <EmptyCard
            icon={Wallet}
            title="No lenders yet"
            body="Add the people whose money the Admin lends out, including the Admin pot."
            href="/lenders"
            action="Add a lender"
          />
        ) : (
          // A strip that scrolls sideways on a phone and lays out as a row on a
          // laptop: the pots are a glance, not a list to work through.
          <ul className="-mx-4 flex snap-x gap-2.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-3">
            {lenders.map((lender) => (
              <li key={lender.id} className="w-56 shrink-0 snap-start sm:w-auto">
                <Link
                  href={`/lenders/${lender.id}`}
                  className="bg-card ring-border/70 shadow-rest hover:shadow-hover hover:ring-brand-line block h-full rounded-2xl p-4 ring-1 transition-[box-shadow,--tw-ring-color] duration-200"
                >
                  <div className="flex items-center gap-2.5">
                    <Avatar name={`${lender.firstName} ${lender.lastName}`} className="size-8 text-[0.65rem]" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {lender.firstName} {lender.lastName}
                    </span>
                    {lender.isSelf ? (
                      <span className="bg-brand-bg text-brand-strong shrink-0 rounded-full px-2 py-0.5 text-[0.7rem] font-medium">
                        Admin
                      </span>
                    ) : null}
                  </div>

                  {/* A ROW PER FIGURE, not three columns. This card is narrow at
                      every width — 224px in the phone strip, about 245px in the
                      widest grid — and a third of that cannot hold a peso amount:
                      three columns clipped "₱19,500.00" against the card edge on
                      every device tested. Label left, figure right always fits,
                      because the label is the part that can give way. */}
                  <dl className="mt-3 space-y-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-muted-foreground shrink-0 text-xs">Floating</dt>
                      <dd className="truncate text-sm font-semibold">
                        <Money amount={lender.position.floating} variant="display" />
                      </dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-muted-foreground shrink-0 text-xs">Out on loan</dt>
                      <dd className="truncate text-sm">
                        <Money
                          amount={lender.position.outOnLoan}
                          variant="display"
                          muted={lender.position.outOnLoan === 0}
                        />
                      </dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-3">
                      {/* position.earned is settledEarnings + settledAdminCuts —
                          interest that has actually REACHED this pot, not what
                          the loans will eventually pay.

                          Widened on 2026-09-25 and the word got truer, not
                          looser. It used to mean "earnings on loans that were
                          repaid", because that was the only way interest could
                          arrive. A weekly loan hands its interest over week by
                          week, and each collected week now lands here the day it
                          is collected while the capital stays under Out on loan.
                          "Earned" describes money in hand either way; what would
                          now be wrong is counting a running loan's whole
                          interest, which is what `pending` is for. */}
                      <dt className="text-muted-foreground shrink-0 text-xs">Earned</dt>
                      <dd className="truncate text-sm">
                        <Money
                          amount={lender.position.earned}
                          variant="display"
                          muted={lender.position.earned === 0}
                        />
                      </dd>
                    </div>
                  </dl>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* BORROWERS BELOW, rating beside the name — a rating you have to open a
          page to see is one you check after you have made up your mind. */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold tracking-tight">Borrowers</h2>
          <Link href="/borrowers" className="text-brand hover:text-brand-strong -my-2 inline-flex min-h-11 items-center py-2 text-xs font-medium pointer-fine:my-0 pointer-fine:min-h-0 pointer-fine:py-0">
            {people.all > SHOWN ? `All ${people.all}` : 'All borrowers'}
          </Link>
        </div>

        {people.all === 0 ? (
          <EmptyCard
            icon={HandCoins}
            title="No borrowers yet"
            body="Add someone here, or create them while recording their first loan."
            href="/loans/new"
            action="Record a loan"
          />
        ) : (
          <ul className="space-y-2">
            {/* Whoever owes the most, first. An alphabetical list on the home
                screen buries the person worth looking at. The ranking is done
                by the query now, not here — see topBorrowers. */}
            {borrowers.map((borrower) => (
                <li key={borrower.id}>
                  <Link
                    href={`/borrowers/${borrower.id}`}
                    className="bg-card ring-border/70 shadow-rest hover:shadow-hover hover:ring-brand-line group flex items-center gap-3 rounded-2xl p-3.5 ring-1 transition-[box-shadow,--tw-ring-color] duration-200"
                  >
                    <Avatar name={`${borrower.firstName} ${borrower.lastName}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium">
                          {borrower.firstName} {borrower.lastName}
                        </span>
                        {borrower.label ? <BorrowerLabelBadge label={borrower.label} /> : null}
                      </div>
                      <TrackRecordLine record={borrower.record} className="mt-1 block" />
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <div className="text-right">
                        <div className="text-muted-foreground text-xs">Owes</div>
                        <Money
                          amount={borrower.outstanding}
                          variant="display"
                          muted={borrower.outstanding === 0}
                          className="text-sm font-semibold"
                        />
                      </div>
                      <ChevronRight
                        className="text-muted-foreground/60 group-hover:text-brand size-4 transition-[color,transform] duration-200 group-hover:translate-x-0.5"
                        aria-hidden
                      />
                    </div>
                  </Link>
                </li>
              ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function EmptyCard({
  icon: Icon,
  title,
  body,
  href,
  action,
}: {
  icon: typeof Users
  title: string
  body: string
  href: string
  action: string
}) {
  return (
    <div className="bg-card/60 border-border rounded-2xl border border-dashed p-8 text-center">
      <span className="bg-brand-bg text-brand mx-auto flex size-11 items-center justify-center rounded-full">
        <Icon className="size-5" aria-hidden />
      </span>
      <p className="mt-3 text-sm font-medium">{title}</p>
      <p className="text-muted-foreground mx-auto mt-1 max-w-xs text-sm">{body}</p>
      <Link
        href={href}
        className="bg-brand text-brand-foreground hover:bg-brand-strong mt-4 inline-flex min-h-11 items-center rounded-lg px-4 text-sm font-medium transition-colors pointer-fine:min-h-9"
      >
        {action}
      </Link>
    </div>
  )
}
