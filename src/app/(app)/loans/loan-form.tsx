'use client'

import { useActionState, useMemo, useState } from 'react'
import { CircleCheck, Plus, TriangleAlert, X } from 'lucide-react'

import { SubmitButton } from '@/components/forms.tsx'
import { Money } from '@/components/money.tsx'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SelectNative } from '@/components/ui/select-native.tsx'
import { type Centavos, centavos, formatPesos, parsePesos } from '@/lib/money/centavos.ts'
import { computeInterest } from '@/lib/money/interest.ts'
import { calendarDate, describeWeeksError, weeksBetween } from '@/lib/money/weeks.ts'
import { type FormState, NO_ERROR } from '@/lib/form-state.ts'

/**
 * The loan form, with the sums shown as they are typed.
 *
 * THE PREVIEW AND THE SERVER USE THE SAME FUNCTIONS. weeksBetween, computeInterest
 * and parsePesos are pure and carry no database, so the figures on screen are
 * produced by the code that will store them — not by a second implementation
 * that agrees with the first until one of them is edited.
 *
 * The preview decides nothing. Every rule is enforced again in the action, which
 * is the only place that can be trusted: a form is a convenience, and a server
 * action is a public endpoint anyone can post to.
 */

export type PersonOption = { id: string; name: string }
export type LenderOption = PersonOption & { isSelf: boolean }

export type LoanFormValues = {
  loanId?: string
  borrowerId: string
  capital: string
  startOn: string
  dueOn: string
  borrowerRate: string
  adminCut: string
  funders: { lenderId: string; amount: string }[]
}

type FunderRow = { key: number; lenderId: string; amount: string; firstName: string; lastName: string }

const NEW = 'new'

/** "2026-09-21" as a calendar date, or null while it is still being typed. */
function readDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const [, year, month, day] = match
  const parsed = calendarDate(new Date(Number(year), Number(month) - 1, Number(day)))
  if (parsed.getMonth() !== Number(month) - 1 || parsed.getDate() !== Number(day)) return null
  return parsed
}

function readPesos(value: string): Centavos | null {
  const parsed = parsePesos(value)
  return parsed.ok ? parsed.value : null
}

/** A percentage as basis points — "7" is 700. Shares the peso parser's two-decimal rule. */
function readRate(value: string, fallback: number): number | null {
  if (value.trim() === '') return fallback
  const parsed = parsePesos(value.replace(/%/g, ''))
  return parsed.ok ? parsed.value : null
}

export function LoanForm({
  action,
  borrowers,
  lenders,
  initial,
  submitLabel,
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>
  borrowers: PersonOption[]
  lenders: LenderOption[]
  initial: LoanFormValues
  submitLabel: string
}) {
  const [state, formAction] = useActionState(action, NO_ERROR)

  const [borrowerId, setBorrowerId] = useState(initial.borrowerId)
  const [capital, setCapital] = useState(initial.capital)
  const [startOn, setStartOn] = useState(initial.startOn)
  const [dueOn, setDueOn] = useState(initial.dueOn)
  const [borrowerRate, setBorrowerRate] = useState(initial.borrowerRate)
  const [adminCut, setAdminCut] = useState(initial.adminCut)
  const [rows, setRows] = useState<FunderRow[]>(
    initial.funders.length > 0
      ? initial.funders.map((funder, index) => ({ key: index, lenderId: funder.lenderId, amount: funder.amount, firstName: '', lastName: '' }))
      : [{ key: 0, lenderId: lenders[0]?.id ?? '', amount: '', firstName: '', lastName: '' }],
  )

  const updateRow = (key: number, patch: Partial<FunderRow>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)))

  const preview = useMemo(() => {
    const capitalValue = readPesos(capital)
    const start = readDate(startOn)
    const due = readDate(dueOn)
    const rateBps = readRate(borrowerRate, 700)

    const weeks = start && due ? weeksBetween(start, due) : null
    const funded = rows.reduce((sum, row) => sum + (readPesos(row.amount) ?? 0), 0)

    const interest =
      capitalValue && capitalValue > 0 && rateBps && rateBps > 0 && weeks?.ok
        ? computeInterest({ capital: capitalValue, rateBps, weeks: weeks.value })
        : null

    return {
      capital: capitalValue,
      weeks,
      interest,
      total: interest !== null && capitalValue !== null ? centavos(capitalValue + interest) : null,
      funded: centavos(funded),
      remaining: capitalValue !== null ? centavos(capitalValue - funded) : null,
    }
  }, [capital, startOn, dueOn, borrowerRate, rows])

  const creatingBorrower = borrowerId === NEW || borrowers.length === 0

  return (
    <form action={formAction} className="space-y-6">
      {initial.loanId ? <input type="hidden" name="loanId" value={initial.loanId} /> : null}

      {/* ── Who ───────────────────────────────────────────────────────────── */}
      <section className="bg-card space-y-3 rounded-xl border p-4">
        <h2 className="text-sm font-semibold">Who is borrowing</h2>

        <div className="space-y-2">
          <Label htmlFor="borrowerId">Borrower</Label>
          <SelectNative
            id="borrowerId"
            name="borrowerId"
            value={creatingBorrower ? NEW : borrowerId}
            onChange={(event) => setBorrowerId(event.target.value)}
          >
            {borrowers.map((borrower) => (
              <option key={borrower.id} value={borrower.id}>
                {borrower.name}
              </option>
            ))}
            {/* Someone can be added without leaving the form — the spec is
                explicit that a borrower need not exist beforehand. */}
            <option value={NEW}>+ Someone new…</option>
          </SelectNative>
        </div>

        {creatingBorrower ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="borrowerFirstName">First name</Label>
              <Input id="borrowerFirstName" name="borrowerFirstName" autoComplete="off" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="borrowerLastName">Last name</Label>
              <Input id="borrowerLastName" name="borrowerLastName" autoComplete="off" required />
            </div>
          </div>
        ) : null}
      </section>

      {/* ── How much, and for how long ────────────────────────────────────── */}
      <section className="bg-card space-y-3 rounded-xl border p-4">
        <h2 className="text-sm font-semibold">The loan</h2>

        <div className="space-y-2">
          {/* "Amount" and "Capital" are the same thing — one field, never two. */}
          <Label htmlFor="capital">Capital handed over</Label>
          <div className="relative">
            <span className="text-muted-foreground pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm" aria-hidden>
              ₱
            </span>
            <Input
              id="capital"
              name="capital"
              inputMode="decimal"
              autoComplete="off"
              placeholder="30,000"
              className="money-column pl-7"
              value={capital}
              onChange={(event) => setCapital(event.target.value)}
              required
            />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="startOn">Start date</Label>
            <Input
              id="startOn"
              name="startOn"
              type="date"
              value={startOn}
              onChange={(event) => setStartOn(event.target.value)}
              required
            />
            <p className="text-muted-foreground text-xs">When the money actually changed hands.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="dueOn">Due date</Label>
            <Input
              id="dueOn"
              name="dueOn"
              type="date"
              value={dueOn}
              onChange={(event) => setDueOn(event.target.value)}
              aria-invalid={preview.weeks !== null && !preview.weeks.ok}
              aria-describedby="weeks-preview"
              required
            />
            <WeeksBadge weeks={preview.weeks} />
          </div>
        </div>

        <details className="text-sm">
          <summary className="text-muted-foreground cursor-pointer text-xs">
            Rates — 7% to the borrower, 2% to you. Change them for this loan only.
          </summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="borrowerRate">Borrower pays, per week</Label>
              <div className="relative">
                <Input
                  id="borrowerRate"
                  name="borrowerRate"
                  inputMode="decimal"
                  placeholder="7"
                  className="pr-7"
                  value={borrowerRate}
                  onChange={(event) => setBorrowerRate(event.target.value)}
                />
                <span className="text-muted-foreground pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm" aria-hidden>
                  %
                </span>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="adminCut">Your cut, per week</Label>
              <div className="relative">
                <Input
                  id="adminCut"
                  name="adminCut"
                  inputMode="decimal"
                  placeholder="2"
                  className="pr-7"
                  value={adminCut}
                  onChange={(event) => setAdminCut(event.target.value)}
                />
                <span className="text-muted-foreground pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm" aria-hidden>
                  %
                </span>
              </div>
              <p className="text-muted-foreground text-xs">
                Your own money earns the whole {borrowerRate || '7'}% — there is no one to pay a share to.
              </p>
            </div>
          </div>
        </details>
      </section>

      {/* ── Whose money ───────────────────────────────────────────────────── */}
      <section className="bg-card space-y-3 rounded-xl border p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Whose money</h2>
          <FundedSoFar funded={preview.funded} remaining={preview.remaining} />
        </div>

        <ul className="space-y-3">
          {rows.map((row) => (
            <li key={row.key} className="space-y-2 rounded-lg border p-3">
              <div className="flex gap-2">
                <SelectNative
                  name="funderLenderId"
                  aria-label="Lender"
                  value={row.lenderId}
                  onChange={(event) => updateRow(row.key, { lenderId: event.target.value })}
                  className="flex-1"
                >
                  {lenders.map((lender) => (
                    <option key={lender.id} value={lender.id}>
                      {lender.isSelf ? `${lender.name} (your pot)` : lender.name}
                    </option>
                  ))}
                  <option value={NEW}>+ Someone new…</option>
                </SelectNative>

                <div className="relative w-36">
                  <span className="text-muted-foreground pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-sm" aria-hidden>
                    ₱
                  </span>
                  <Input
                    name="funderAmount"
                    aria-label="Amount from this lender"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="0.00"
                    className="money-column pl-6"
                    value={row.amount}
                    onChange={(event) => updateRow(row.key, { amount: event.target.value })}
                  />
                </div>

                {rows.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}
                  >
                    <X className="size-4" aria-hidden />
                    <span className="sr-only">Remove this funder</span>
                  </Button>
                ) : null}
              </div>

              {/* Every row posts all four fields, empty or not, so the arrays the
                  action reads line up by position. */}
              <div className={row.lenderId === NEW ? 'grid gap-2 sm:grid-cols-2' : 'hidden'}>
                <Input
                  name="funderFirstName"
                  aria-label="New lender first name"
                  placeholder="First name"
                  autoComplete="off"
                  value={row.firstName}
                  onChange={(event) => updateRow(row.key, { firstName: event.target.value })}
                />
                <Input
                  name="funderLastName"
                  aria-label="New lender last name"
                  placeholder="Last name"
                  autoComplete="off"
                  value={row.lastName}
                  onChange={(event) => updateRow(row.key, { lastName: event.target.value })}
                />
              </div>
            </li>
          ))}
        </ul>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            setRows((current) => [
              ...current,
              { key: Math.max(0, ...current.map((row) => row.key)) + 1, lenderId: lenders[0]?.id ?? '', amount: '', firstName: '', lastName: '' },
            ])
          }
        >
          <Plus className="size-4" aria-hidden />
          Add another funder
        </Button>
      </section>

      <Preview capital={preview.capital} interest={preview.interest} total={preview.total} weeks={preview.weeks} />

      {state.error ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      <SubmitButton pendingLabel="Saving…" className="w-full sm:w-auto">
        {submitLabel}
      </SubmitButton>
    </form>
  )
}

/**
 * The live "= 4 weeks" badge.
 *
 * The spec asks for this by name, and it is the reason the form refuses dates
 * that do not divide evenly rather than rounding them: a 30-day gap is 4.29
 * weeks, and rounding it silently moves ₱8,400 of interest to ₱10,500.
 */
function WeeksBadge({ weeks }: { weeks: ReturnType<typeof weeksBetween> | null }) {
  if (weeks === null) {
    return (
      <p id="weeks-preview" className="text-muted-foreground text-xs">
        Must land on a whole number of weeks.
      </p>
    )
  }

  if (weeks.ok) {
    return (
      <p id="weeks-preview" className="text-status-good inline-flex items-center gap-1.5 text-sm font-semibold">
        <CircleCheck className="size-4 shrink-0" aria-hidden />= {weeks.value === 1 ? '1 week' : `${weeks.value} weeks`}
      </p>
    )
  }

  return (
    <p id="weeks-preview" className="text-status-critical inline-flex items-start gap-1.5 text-xs font-medium">
      <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      {describeWeeksError(weeks.error)}
    </p>
  )
}

function FundedSoFar({ funded, remaining }: { funded: Centavos; remaining: Centavos | null }) {
  if (remaining === null) return null

  if (remaining === 0 && funded > 0) {
    return (
      <span className="text-status-good inline-flex items-center gap-1.5 text-xs font-medium">
        <CircleCheck className="size-3.5 shrink-0" aria-hidden />
        Fully funded
      </span>
    )
  }

  return (
    <span className="text-muted-foreground text-xs">
      {remaining > 0 ? `${formatPesos(remaining)} left` : `${formatPesos(centavos(-remaining))} over`}
    </span>
  )
}

/** What the borrower will owe, worked out as the form is filled in. */
function Preview({
  capital,
  interest,
  total,
  weeks,
}: {
  capital: Centavos | null
  interest: Centavos | null
  total: Centavos | null
  weeks: ReturnType<typeof weeksBetween> | null
}) {
  if (capital === null || interest === null || total === null || !weeks?.ok) {
    return (
      <div className="text-muted-foreground rounded-xl border border-dashed p-4 text-center text-sm">
        Fill in the capital and both dates to see what is owed.
      </div>
    )
  }

  return (
    <div className="bg-muted/40 rounded-xl border p-4">
      <dl className="grid grid-cols-3 gap-3 text-center">
        <div>
          <dt className="text-muted-foreground text-xs">Capital</dt>
          <dd className="mt-0.5 text-sm font-medium">
            <Money amount={capital} variant="display" />
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">
            Interest · {weeks.value === 1 ? '1 week' : `${weeks.value} weeks`}
          </dt>
          <dd className="mt-0.5 text-sm font-medium">
            <Money amount={interest} variant="display" />
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">They repay</dt>
          <dd className="mt-0.5 text-base font-semibold">
            <Money amount={total} variant="display" />
          </dd>
        </div>
      </dl>
      <p className="text-muted-foreground mt-3 text-center text-xs">
        Worked out once, now. It never changes afterwards.
      </p>
    </div>
  )
}
