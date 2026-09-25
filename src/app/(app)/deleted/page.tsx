import Link from 'next/link'
import { Trash2 } from 'lucide-react'

import { ActionForm } from '@/components/forms.tsx'
import { cn } from '@/lib/utils'
import { Money } from '@/components/money.tsx'
import { requireUser } from '@/server/auth/guard.ts'
import {
  type DeletedPerson,
  type DeletedRow,
  type DeletedSection,
  DELETED_SECTIONS,
  isEmpty,
  listDeleted,
} from '@/server/deleted/queries.ts'
import { Pager } from '@/components/pager.tsx'
import { parsePage } from '@/lib/pagination.ts'
import { PURGE_AFTER_DAYS, daysUntilPurge } from '@/server/deleted/window.ts'
import { restoreBorrower } from '@/server/borrowers/actions.ts'
import { restoreLender, restoreTransaction } from '@/server/lenders/actions.ts'
import { restoreLoan } from '@/server/loans/actions.ts'

export const metadata = { title: 'Recently Deleted' }

const dateFormat = new Intl.DateTimeFormat('en-PH', { day: 'numeric', month: 'short', year: 'numeric' })

/**
 * Where deleted things wait out their thirty days.
 *
 * Deleting sets `deletedAt` and the ordinary screens stop returning the row.
 * Without this page that would be a one-way door: the data is still there and
 * unreachable, which is the same as losing it for anyone who does not have a
 * database client open.
 *
 * Restoring is the only button here. There is deliberately no "delete
 * permanently": the purge already destroys these on a clock, and a manual
 * second delete would be the one action in the app with no undo behind it AND
 * no waiting period in front of it.
 *
 * Every row carries its countdown, because a bin that quietly empties itself
 * without ever having said so is worse than no bin.
 */
/** The tab labels, in the order they appear. */
const TABS: { section: DeletedSection; label: string; noun: string }[] = [
  { section: 'loans', label: 'Loans', noun: 'loans' },
  { section: 'borrowers', label: 'Borrowers', noun: 'people' },
  { section: 'lenders', label: 'Lenders', noun: 'people' },
  { section: 'transactions', label: 'Money in and out', noun: 'movements' },
]

function isSection(value: string): value is DeletedSection {
  return (DELETED_SECTIONS as string[]).includes(value)
}

export default async function RecentlyDeletedPage({ searchParams }: PageProps<'/deleted'>) {
  const user = await requireUser()
  const params = await searchParams

  // ONE GROUP AT A TIME, behind tabs. Stacked, the four groups ran to forty
  // cards of deleted things before you reached the one you came back for — and
  // the three you are not looking at were all fetched to build it.
  const asked = Array.isArray(params.tab) ? params.tab[0] : params.tab
  const tab: DeletedSection = asked && isSection(asked) ? asked : 'loans'
  const paging = parsePage(params.page)

  const deleted = await listDeleted(user.id, tab, paging)

  /** A page link inside the current tab. Changing tab drops the page, on purpose. */
  const hrefFor = (page: number) =>
    page > 1 ? `/deleted?tab=${tab}&page=${page}` : `/deleted?tab=${tab}`

  const rows = deleted[tab]
  const total = deleted.counts[tab]
  const noun = TABS.find((t) => t.section === tab)?.noun ?? 'rows'

  if (isEmpty(deleted)) {
    return (
      <div className="space-y-6">
        <Header />
        <div className="bg-card/60 border-border rounded-2xl border border-dashed p-10 text-center">
          <Trash2 className="text-muted-foreground mx-auto size-7" aria-hidden />
          <p className="mt-3 text-sm font-medium">Nothing deleted</p>
          <p className="text-muted-foreground mx-auto mt-1 max-w-xs text-sm">
            Anything the Admin deletes waits here for {PURGE_AFTER_DAYS} days, and comes back whole.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Header />

      <Tabs current={tab} counts={deleted.counts} />

      {tab === 'loans' ? (
        <ul className="space-y-2">
        {deleted.loans.map((loan) => (
          <Row
            key={loan.id}
            title={loan.borrowerName}
            detail={
              <>
                <Money amount={loan.capital} variant="display" /> lent · repays{' '}
                <Money amount={loan.total} variant="display" /> · due {dateFormat.format(loan.dueOn)}
              </>
            }
            footnote={<Countdown row={loan} />}
            action={
              <ActionForm
                action={restoreLoan}
                values={{ loanId: loan.id }}
                variant="outline"
                size="sm"
                pendingLabel="Restoring…"
                confirm={{
                  title: 'Restore this loan?',
                  body: 'It comes back whole, with its payment and proof, and leaves Recently Deleted.',
                  action: 'Restore loan',
                }}
              >
                Restore
              </ActionForm>
            }
          />
        ))}
        </ul>
      ) : null}

      {tab === 'lenders' ? (
        <ul className="space-y-2">
        {deleted.lenders.map((lender) => (
          <Row
            key={lender.id}
            title={`${lender.firstName} ${lender.lastName}`}
            detail="Their loans and money in and out came with them."
            footnote={<Countdown row={lender} held={heldReason(lender, 'loans they funded')} />}
            action={
              <ActionForm
                action={restoreLender}
                values={{ lenderId: lender.id }}
                variant="outline"
                size="sm"
                pendingLabel="Restoring…"
                confirm={{
                  title: 'Restore this lender?',
                  body: 'They come back with their money in and out, and leave Recently Deleted.',
                  action: 'Restore lender',
                }}
              >
                Restore
              </ActionForm>
            }
          />
        ))}
        </ul>
      ) : null}

      {tab === 'borrowers' ? (
        <ul className="space-y-2">
        {deleted.borrowers.map((borrower) => (
          <Row
            key={borrower.id}
            title={`${borrower.firstName} ${borrower.lastName}`}
            detail="Their whole loan history came with them."
            footnote={<Countdown row={borrower} held={heldReason(borrower, 'loans of theirs')} />}
            action={
              <ActionForm
                action={restoreBorrower}
                values={{ borrowerId: borrower.id }}
                variant="outline"
                size="sm"
                pendingLabel="Restoring…"
                confirm={{
                  title: 'Restore this borrower?',
                  body: 'They come back with their whole loan history, and leave Recently Deleted.',
                  action: 'Restore borrower',
                }}
              >
                Restore
              </ActionForm>
            }
          />
        ))}
        </ul>
      ) : null}

      {tab === 'transactions' ? (
        <ul className="space-y-2">
        {deleted.transactions.map((entry) => (
          <Row
            key={entry.id}
            title={entry.lenderName}
            detail={
              <>
                {entry.type === 'DEPOSIT' ? 'Money in' : 'Money out'}{' '}
                <Money amount={entry.amount} variant="display" /> ·{' '}
                {dateFormat.format(entry.occurredOn)}
              </>
            }
            footnote={<Countdown row={entry} />}
            action={
              <ActionForm
                action={restoreTransaction}
                values={{ transactionId: entry.id }}
                variant="outline"
                size="sm"
                pendingLabel="Restoring…"
                confirm={{
                  title: 'Restore this entry?',
                  body: "It comes back and leaves Recently Deleted. The lender's balance changes right away.",
                  action: 'Restore entry',
                }}
              >
                Restore
              </ActionForm>
            }
          />
        ))}
        </ul>
      ) : null}

      {/* A tab can be empty while the bin is not — nothing here says the bin is
          empty, only this group is. The empty bin has its own screen above. */}
      {rows.length === 0 ? (
        <p className="text-muted-foreground bg-card/60 border-border rounded-2xl border border-dashed p-8 text-center text-sm">
          {total === 0 ? 'Nothing deleted in this group.' : 'Nothing on this page.'}
        </p>
      ) : null}

      <Pager page={paging.page} total={total} noun={noun} href={hrefFor} />
    </div>
  )
}

/**
 * One group at a time.
 *
 * Links, not buttons — same reasoning as the loan status chips: a tab is a
 * place, so it belongs in the URL and works with no JavaScript. Each carries
 * its count, so you can see where things are without opening all four.
 */
function Tabs({
  current,
  counts,
}: {
  current: DeletedSection
  counts: Record<DeletedSection, number>
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {TABS.map((tab) => {
        const on = tab.section === current
        return (
          <Link
            key={tab.section}
            href={`/deleted?tab=${tab.section}`}
            aria-current={on ? 'page' : undefined}
            className={cn(
              'inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors pointer-fine:min-h-0 pointer-fine:py-1.5',
              on
                ? 'bg-brand text-brand-foreground border-brand shadow-rest'
                : 'border-border hover:bg-muted hover:border-brand-line',
            )}
          >
            {tab.label}
            <span className={on ? 'text-brand-foreground/70' : 'text-muted-foreground'}>
              {counts[tab.section]}
            </span>
          </Link>
        )
      })}
    </div>
  )
}

function Header() {
  return (
    <div>
      <h1 className="text-[1.75rem] font-semibold tracking-tight">Recently Deleted</h1>
      <p className="text-muted-foreground text-sm">
        Nothing here is gone yet. Restore it and it comes back exactly as it was. After{' '}
        {PURGE_AFTER_DAYS} days it is destroyed for good.
      </p>
    </div>
  )
}

/** Why the clock does not apply to this person, or nothing when it does. */
function heldReason(person: DeletedPerson, what: string): string | null {
  return person.held ? `Kept while there are still ${what}.` : null
}

/**
 * How long this row has left.
 *
 * The last three days are called out in the warning colour. Before that the
 * countdown is information; inside three days it is the last chance to act on
 * something that cannot be undone afterwards.
 */
function Countdown({ row, held }: { row: DeletedRow; held?: string | null }) {
  if (held) return <span className="text-muted-foreground">{held}</span>

  const days = daysUntilPurge(row.deletedAt)

  if (days === 0) {
    return <span className="text-status-critical font-medium">Due to be destroyed in the next purge</span>
  }

  return (
    <span className={days <= 3 ? 'text-status-warning font-medium' : 'text-muted-foreground'}>
      Deleted {dateFormat.format(row.deletedAt)} · gone in {days} {days === 1 ? 'day' : 'days'}
    </span>
  )
}

function Row({
  title,
  detail,
  footnote,
  action,
}: {
  title: string
  detail: React.ReactNode
  footnote: React.ReactNode
  action: React.ReactNode
}) {
  return (
    <li className="bg-card flex flex-wrap items-center gap-3 rounded-2xl p-4 ring-1 ring-border/70 shadow-rest">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{title}</div>
        <div className="text-muted-foreground mt-0.5 text-xs">{detail}</div>
        <div className="mt-1 text-xs">{footnote}</div>
      </div>
      {action}
    </li>
  )
}
