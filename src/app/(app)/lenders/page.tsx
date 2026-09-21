import Link from 'next/link'
import { ChevronRight, Wallet } from 'lucide-react'

import { Money } from '@/components/money.tsx'
import { StatTile } from '@/components/stat-tile.tsx'
import { centavos, formatPesos } from '@/lib/money/centavos.ts'
import { requireUser } from '@/server/auth/guard.ts'
import { listLenders } from '@/server/lenders/queries.ts'

import { AddLender } from './add-lender.tsx'

export const metadata = { title: 'Lenders · Lending App' }

/**
 * Whose money is in play, and where it is.
 *
 * The admin's own pot sits first and reads the same as everyone else's. It IS a
 * lender row — the only difference is the rate its money earns — so it is not
 * given a separate panel or a special case here.
 *
 * Three figures per lender, in the order the spec asks for them: Floating, Out
 * on loan, Earned. Every one of them is derived on this read; not one is stored.
 */
export default async function LendersPage() {
  const user = await requireUser()
  const lenders = await listLenders(user.id)

  const totals = lenders.reduce(
    (sum, lender) => ({
      floating: sum.floating + lender.position.floating,
      out: sum.out + lender.position.outOnLoan,
    }),
    { floating: 0, out: 0 },
  )

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Lenders</h1>
          <p className="text-muted-foreground text-sm">
            {lenders.length === 1 ? '1 pot' : `${lenders.length} pots`} · idle cash and what is out
          </p>
        </div>
        <AddLender />
      </div>

      <StatTile
        hero
        label="Floating across everyone"
        value={<Money amount={centavos(totals.floating)} variant="display" />}
        note={`${formatPesos(centavos(totals.out))} out on loan`}
      />

      {lenders.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <Wallet className="text-muted-foreground mx-auto size-7" aria-hidden />
          <p className="mt-3 text-sm font-medium">No lenders yet</p>
          <p className="text-muted-foreground mx-auto mt-1 max-w-xs text-sm">
            Add the people whose money you lend out — including your own pot.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {lenders.map((lender) => (
            <li key={lender.id}>
              <Link
                href={`/lenders/${lender.id}`}
                className="bg-card hover:bg-muted/40 block rounded-xl border p-4 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">
                    {lender.firstName} {lender.lastName}
                  </span>
                  {lender.isSelf ? (
                    <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs">
                      Your pot
                    </span>
                  ) : null}
                  <ChevronRight className="text-muted-foreground ml-auto size-4 shrink-0" aria-hidden />
                </div>

                {/* Three columns at every width. On a phone this is the whole
                    answer to "how much can I lend today" without a tap. */}
                <dl className="mt-3 grid grid-cols-3 gap-2">
                  <div>
                    <dt className="text-muted-foreground text-xs">Floating</dt>
                    <dd className="mt-0.5 text-sm font-semibold">
                      <Money amount={lender.position.floating} variant="display" />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground text-xs">Out on loan</dt>
                    <dd className="mt-0.5 text-sm">
                      <Money amount={lender.position.outOnLoan} variant="display" muted={lender.position.outOnLoan === 0} />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground text-xs">Earned</dt>
                    <dd className="mt-0.5 text-sm">
                      <Money amount={lender.position.earned} variant="display" muted={lender.position.earned === 0} />
                    </dd>
                  </div>
                </dl>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
