import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AlertTriangle, ArrowLeft, HandCoins } from 'lucide-react'

import { BorrowerLabelBadge } from '@/components/borrower-rating.tsx'
import { LoanStatusBadge } from '@/components/loan-status.tsx'
import { Money } from '@/components/money.tsx'
import { Pager } from '@/components/pager.tsx'
import { describeTerm } from '@/lib/money/weeks.ts'
import { PAGE_SIZE, parsePage } from '@/lib/pagination.ts'
import { StatRow, StatTile } from '@/components/stat-tile.tsx'
import { requireUser } from '@/server/auth/guard.ts'
import { getBorrower } from '@/server/borrowers/queries.ts'

import { BorrowerSettings, LabelPicker } from './borrower-settings.tsx'

const dateFormat = new Intl.DateTimeFormat('en-PH', { day: 'numeric', month: 'short', year: 'numeric' })

export async function generateMetadata({ params }: PageProps<'/borrowers/[id]'>) {
  const user = await requireUser()
  const borrower = await getBorrower(user.id, (await params).id)
  if (!borrower) return { title: 'Borrower' }
  return { title: `${borrower.firstName} ${borrower.lastName}` }
}

/**
 * One borrower's whole history.
 *
 * Paid loans stay here forever — that history IS the point of the profile, and
 * hiding it once the money is back would throw away the only evidence of whether
 * this person pays.
 *
 * The counted line and the admin's label are shown together, never one without
 * the other. The counts are arithmetic; the label is an opinion; each says
 * something the other cannot.
 */
export default async function BorrowerPage({ params, searchParams }: PageProps<'/borrowers/[id]'>) {
  const user = await requireUser()
  const borrower = await getBorrower(user.id, (await params).id)
  if (!borrower) notFound()

  const { record } = borrower

  /* The history is kept forever, so it only grows. Ten at a time below; the
     counted line and the tiles above are still over every loan there has ever
     been, which is the figure the profile exists to give. */
  const { page: at } = parsePage((await searchParams).page)
  const loans = borrower.loans.slice((at - 1) * PAGE_SIZE, at * PAGE_SIZE)

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/borrowers"
          className="text-muted-foreground hover:text-foreground -my-2 inline-flex min-h-11 items-center gap-1 py-2 text-sm pointer-fine:my-0 pointer-fine:min-h-0 pointer-fine:py-0"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Borrowers
        </Link>

        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[1.75rem] font-semibold tracking-tight">
                {borrower.firstName} {borrower.lastName}
              </h1>
              {borrower.label ? <BorrowerLabelBadge label={borrower.label} /> : null}
            </div>
            <p className="text-muted-foreground text-sm">
              {record.total === 0
                ? 'No loans yet.'
                : `${record.total === 1 ? '1 loan' : `${record.total} loans`} · ${record.paidOnTime} paid on time · ${record.paidLate} late`}
            </p>
          </div>
          <BorrowerSettings
            borrowerId={borrower.id}
            firstName={borrower.firstName}
            lastName={borrower.lastName}
          />
        </div>
      </div>

      <StatTile
        hero
        icon={HandCoins}
        label="Owes right now"
        value={<Money amount={borrower.outstanding} variant="display" />}
        note={record.active === 1 ? 'across 1 active loan' : `across ${record.active} active loans`}
        tone={record.overdue > 0 ? 'critical' : undefined}
      />

      <StatRow>
        <StatTile label="Loans taken" value={String(record.total)} />
        <StatTile label="Paid on time" value={String(record.paidOnTime)} />
        <StatTile
          label="Paid late"
          value={String(record.paidLate)}
          icon={record.paidLate > 0 ? AlertTriangle : undefined}
        />
      </StatRow>

      <LabelPicker borrowerId={borrower.id} current={borrower.label} />

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-base font-semibold tracking-tight">Loans</h2>
          {borrower.loans.length > 0 ? (
            <p className="text-muted-foreground text-xs">
              {borrower.loans.length === 1 ? '1 loan' : `${borrower.loans.length} loans`} in all
            </p>
          ) : null}
        </div>

        {borrower.loans.length === 0 ? (
          <div className="bg-card/60 border-border rounded-2xl border border-dashed p-10 text-center">
            <HandCoins className="text-muted-foreground mx-auto size-7" aria-hidden />
            <p className="mt-3 text-sm font-medium">No loans yet</p>
            <p className="text-muted-foreground mx-auto mt-1 max-w-xs text-sm">
              Every loan this person takes stays here, paid ones included.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {loans.map((loan) => (
              <li key={loan.id} className="bg-card rounded-2xl p-4 ring-1 ring-border/70 shadow-rest">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Money amount={loan.total} variant="display" className="text-base font-semibold" />
                    <div className="text-muted-foreground mt-0.5 text-xs">
                      <Money amount={loan.capital} variant="display" /> capital ·{' '}
                      {describeTerm(loan.termDays)} · interest{' '}
                      <Money amount={loan.interest} variant="display" />
                    </div>
                  </div>
                  <LoanStatusBadge state={loan.state} />
                </div>

                <div className="text-muted-foreground mt-2 text-xs">
                  {dateFormat.format(loan.startOn)} → {dateFormat.format(loan.dueOn)}
                  {loan.paidOn ? ` · paid ${dateFormat.format(loan.paidOn)}` : ''}
                </div>

                {/* Who funded it. On this screen it is context, not the subject —
                    the lender's own page is where the money is tracked. */}
                <div className="text-muted-foreground mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                  {loan.funders.map((funder) => (
                    <span key={funder.lenderId}>
                      {funder.name} <Money amount={funder.principal} variant="display" />
                    </span>
                  ))}
                </div>

                {/* Proof is optional but flagged — a payment can be recorded with
                    the screenshot still on someone's phone, and this is what stops
                    that being forgotten. */}
                {loan.missingProof ? (
                  <p className="text-status-warning mt-2 inline-flex items-center gap-1.5 text-xs font-medium">
                    <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
                    Paid with no proof attached
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        <Pager
          page={at}
          total={borrower.loans.length}
          noun="loans"
          href={(to) => (to > 1 ? `/borrowers/${borrower.id}?page=${to}` : `/borrowers/${borrower.id}`)}
        />
      </section>
    </div>
  )
}
