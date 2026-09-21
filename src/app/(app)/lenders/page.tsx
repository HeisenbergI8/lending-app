import Link from 'next/link'
import { ChevronRight, Wallet } from 'lucide-react'

import { Avatar } from '@/components/avatar.tsx'
import { Money } from '@/components/money.tsx'
import { StatTile } from '@/components/stat-tile.tsx'
import { centavos, formatPesos } from '@/lib/money/centavos.ts'
import { requireUser } from '@/server/auth/guard.ts'
import { listLenders } from '@/server/lenders/queries.ts'

import { AddLender } from './add-lender.tsx'

export const metadata = { title: 'Lenders · Consignment Kush' }

/**
 * Whose money is in play, and where it is.
 *
 * The admin's own pot sits first and reads the same as everyone else's. It IS a
 * lender row — the only difference is the rate its money earns — so it is not
 * given a separate panel or a special case here.
 *
 * Four figures per lender: Floating, Out on loan, Earned, Withdrawn. Every one
 * of them is derived on this read; not one is stored.
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
          <h1 className="text-[1.75rem] font-semibold tracking-tight">Lenders</h1>
          <p className="text-muted-foreground text-sm">
            {lenders.length === 1 ? '1 pot' : `${lenders.length} pots`} · idle cash and what is out
          </p>
        </div>
        <AddLender />
      </div>

      <StatTile
        hero
        icon={Wallet}
        label="Floating across everyone"
        value={<Money amount={centavos(totals.floating)} variant="display" />}
        note={`${formatPesos(centavos(totals.out))} out on loan`}
      />

      {lenders.length === 0 ? (
        <div className="bg-card/60 border-border rounded-2xl border border-dashed p-10 text-center">
          <Wallet className="text-muted-foreground mx-auto size-7" aria-hidden />
          <p className="mt-3 text-sm font-medium">No lenders yet</p>
          <p className="text-muted-foreground mx-auto mt-1 max-w-xs text-sm">
            Add the people whose money the Admin lends out, including the Admin pot.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {lenders.map((lender) => (
            <li key={lender.id}>
              <Link
                href={`/lenders/${lender.id}`}
                className="bg-card group block p-4 rounded-2xl ring-1 ring-border/70 shadow-rest hover:shadow-hover hover:ring-brand-line transition-[box-shadow,--tw-ring-color] duration-200"
              >
                <div className="flex items-center gap-2.5">
                  <Avatar name={`${lender.firstName} ${lender.lastName}`} />
                  <span className="truncate font-medium">
                    {lender.firstName} {lender.lastName}
                  </span>
                  {lender.isSelf ? (
                    <span className="bg-brand-bg text-brand-strong shrink-0 rounded-full px-2 py-0.5 text-[0.7rem] font-medium">
                      Admin pot
                    </span>
                  ) : null}
                  <ChevronRight
                    className="text-muted-foreground/60 group-hover:text-brand ml-auto size-4 shrink-0 transition-[color,transform] duration-200 group-hover:translate-x-0.5"
                    aria-hidden
                  />
                </div>

                {/* All four figures without a tap, which is the whole answer to
                    "how much can I lend today" and "how much has this person
                    taken back out".

                    A row per figure on a phone, two columns from `sm` and four
                    from `lg`. A quarter of a 375px card is about 66px, and a
                    six-figure peso amount needs roughly twice that; it fit the
                    demo's numbers and would have started clipping the day a
                    larger one was entered. Label left and figure right has no
                    such ceiling. */}
                <dl className="mt-3 grid gap-1 sm:grid-cols-2 sm:gap-2 lg:grid-cols-4">
                  <div className="flex items-baseline justify-between gap-3 sm:block">
                    <dt className="text-muted-foreground shrink-0 text-xs">Floating</dt>
                    <dd className="truncate text-sm font-semibold sm:mt-0.5">
                      <Money amount={lender.position.floating} variant="display" />
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3 sm:block">
                    <dt className="text-muted-foreground shrink-0 text-xs">Out on loan</dt>
                    <dd className="truncate text-sm sm:mt-0.5">
                      <Money amount={lender.position.outOnLoan} variant="display" muted={lender.position.outOnLoan === 0} />
                    </dd>
                  </div>
                  {/* `earned` is settled own earnings + settled admin cuts. The
                      cut is the admin pot's 2% on OTHER funders' principal, and
                      it is 0 on every other row, so a bare "Earned" here reads
                      as "what this capital earned" and is short of the truth on
                      exactly one row. The second line names the difference
                      rather than hiding it in the total. */}
                  <div className="flex items-baseline justify-between gap-3 sm:block">
                    <dt className="text-muted-foreground shrink-0 text-xs">Earned</dt>
                    <dd className="truncate text-sm sm:mt-0.5">
                      <Money amount={lender.position.earned} variant="display" muted={lender.position.earned === 0} />
                      {lender.position.adminCutEarned > 0 ? (
                        <span className="text-muted-foreground block truncate text-xs">
                          includes {formatPesos(lender.position.adminCutEarned)} cut from other lenders
                        </span>
                      ) : null}
                    </dd>
                  </div>
                  {/* `withdrawals` is SUM("amountCentavos") over this lender's
                      WITHDRAWAL transactions that are not deleted, for THIS
                      user. ALL TIME, with no date bound — which is what the bare
                      word promises, and what the admin is asking when they ask
                      how much someone has taken back.

                      It is not part of the other three figures. The money left
                      the pot, and without this column "Floating" simply looks
                      low for no visible reason. */}
                  <div className="flex items-baseline justify-between gap-3 sm:block">
                    <dt className="text-muted-foreground shrink-0 text-xs">Withdrawn</dt>
                    <dd className="truncate text-sm sm:mt-0.5">
                      <Money
                        amount={lender.position.withdrawals}
                        variant="display"
                        muted={lender.position.withdrawals === 0}
                      />
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
