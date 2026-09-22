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
import { type InterestBasis, computeInterest } from '@/lib/money/interest.ts'
import {
  DAYS_PER_WEEK,
  describeTerm,
  describeTermError,
  describeWeeksError,
  parseCalendarDate,
  termDaysBetween,
  weeksBetween,
} from '@/lib/money/weeks.ts'
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
  interestBasis: InterestBasis
  borrowerRate: string
  adminCut: string
  /** Both blank on a weekly-rate loan. Pesos, as typed. */
  fixedInterest: string
  fixedLenderShare: string
  funders: { lenderId: string; amount: string }[]
}

/**
 * How long the loan runs, in days, or what is wrong with the two dates.
 *
 * ONE function for both bases so the badge beside the due date has one shape to
 * render. The rule they differ on is the whole point of the choice: a weekly
 * rate multiplies by the week count, so the dates must divide by seven, and a
 * fixed amount does not, so three days is simply three days.
 */
type Term = { ok: true; days: number } | { ok: false; message: string }

function termOf(basis: InterestBasis, startOn: string, dueOn: string): Term | null {
  const start = parseCalendarDate(startOn)
  const due = parseCalendarDate(dueOn)
  if (!start || !due) return null

  if (basis === 'FIXED_AMOUNT') {
    const days = termDaysBetween(start, due)
    return days.ok ? { ok: true, days: days.value } : { ok: false, message: describeTermError(days.error) }
  }

  const weeks = weeksBetween(start, due)
  return weeks.ok
    ? { ok: true, days: weeks.value * DAYS_PER_WEEK }
    : { ok: false, message: describeWeeksError(weeks.error) }
}

type FunderRow = {
  key: number
  lenderId: string
  amount: string
  /** Whether the admin has typed an amount into this row. An untouched row mirrors what is left. */
  touched: boolean
  firstName: string
  lastName: string
}

const NEW = 'new'

function readPesos(value: string): Centavos | null {
  const parsed = parsePesos(value)
  return parsed.ok ? parsed.value : null
}

/** "30,000.00" — what formatPesos gives, without the sign the field already prints. */
const toAmountField = (amount: Centavos) => formatPesos(amount).replace('₱', '')

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
  const [basis, setBasis] = useState<InterestBasis>(initial.interestBasis)
  const [borrowerRate, setBorrowerRate] = useState(initial.borrowerRate)
  const [adminCut, setAdminCut] = useState(initial.adminCut)
  const [fixedInterest, setFixedInterest] = useState(initial.fixedInterest)
  const [fixedLenderShare, setFixedLenderShare] = useState(initial.fixedLenderShare)
  const [rows, setRows] = useState<FunderRow[]>(
    initial.funders.length > 0
      ? initial.funders.map((funder, index) => ({
          key: index,
          lenderId: funder.lenderId,
          amount: funder.amount,
          // An existing loan's split was decided by the admin, so every row it
          // comes back with counts as typed. Editing must never re-spread it.
          touched: funder.amount.trim() !== '',
          firstName: '',
          lastName: '',
        }))
      : [{ key: 0, lenderId: lenders[0]?.id ?? '', amount: '', touched: false, firstName: '', lastName: '' }],
  )

  const updateRow = (key: number, patch: Partial<FunderRow>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)))

  /**
   * WHAT EACH ROW SHOWS IN ITS AMOUNT BOX.
   *
   * A row the admin has not typed into mirrors what is still unfunded, so the
   * ordinary case — one lender putting up the whole capital — fills itself in
   * from the capital handed over and needs no second typing of the same figure.
   * Add a second funder after typing ₱20,000 into the first and it arrives
   * holding the remaining ₱10,000.
   *
   * Only the FIRST untouched row is given the remainder. Splitting it between
   * several would be a guess at a decision that is the admin's to make, and the
   * figure it guessed would be posted if they never looked.
   */
  const amounts = useMemo(() => {
    const capitalValue = readPesos(capital)
    const typed = rows.reduce((sum, row) => (row.touched ? sum + (readPesos(row.amount) ?? 0) : sum), 0)
    const spare = capitalValue === null ? 0 : capitalValue - typed
    const firstUntouched = rows.find((row) => !row.touched)?.key

    return new Map(
      rows.map((row) => [
        row.key,
        row.touched ? row.amount : row.key === firstUntouched && spare > 0 ? toAmountField(centavos(spare)) : '',
      ]),
    )
  }, [capital, rows])

  const preview = useMemo(() => {
    const capitalValue = readPesos(capital)
    const rateBps = readRate(borrowerRate, 700)

    const term = termOf(basis, startOn, dueOn)
    const funded = rows.reduce((sum, row) => sum + (readPesos(amounts.get(row.key) ?? '') ?? 0), 0)

    // A fixed amount is not worked out at all — it is the figure the admin
    // typed, shown back so the total beside it can be checked before saving.
    const interest =
      basis === 'FIXED_AMOUNT'
        ? readPesos(fixedInterest)
        : capitalValue && capitalValue > 0 && rateBps && rateBps > 0 && term?.ok
          ? computeInterest({ capital: capitalValue, rateBps, weeks: term.days / DAYS_PER_WEEK })
          : null

    return {
      capital: capitalValue,
      term,
      interest,
      total: interest !== null && capitalValue !== null ? centavos(capitalValue + interest) : null,
      funded: centavos(funded),
      remaining: capitalValue !== null ? centavos(capitalValue - funded) : null,
    }
  }, [capital, startOn, dueOn, basis, borrowerRate, fixedInterest, rows, amounts])

  const creatingBorrower = borrowerId === NEW || borrowers.length === 0

  return (
    <form action={formAction} className="space-y-6">
      {initial.loanId ? <input type="hidden" name="loanId" value={initial.loanId} /> : null}

      {/* ── Who ───────────────────────────────────────────────────────────── */}
      <section className="bg-card space-y-3 rounded-2xl p-4 ring-1 ring-border/70 shadow-rest">
        <h2 className="text-base font-semibold tracking-tight">Who is borrowing</h2>

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
      <section className="bg-card space-y-3 rounded-2xl p-4 ring-1 ring-border/70 shadow-rest">
        <h2 className="text-base font-semibold tracking-tight">The loan</h2>

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
              aria-invalid={preview.term !== null && !preview.term.ok}
              aria-describedby="term-preview"
              required
            />
            <TermBadge basis={basis} term={preview.term} />
          </div>
        </div>

        {/* HOW THE INTEREST IS SET, chosen per loan and never hidden behind a
            disclosure. The weekly rate is the default and covers nearly every
            loan; a fixed amount is for the ones no rate describes honestly, like
            three days for an amount agreed with the borrower. */}
        <fieldset className="text-sm">
          <legend className="text-muted-foreground text-xs">How the interest is set</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <BasisChoice
              value="WEEKLY_RATE"
              current={basis}
              onSelect={setBasis}
              title="A weekly rate"
              hint="The usual. Runs in whole weeks."
            />
            <BasisChoice
              value="FIXED_AMOUNT"
              current={basis}
              onSelect={setBasis}
              title="A fixed amount"
              hint="Typed in pesos. Any number of days."
            />
          </div>
        </fieldset>

        {basis === 'FIXED_AMOUNT' ? (
          <div className="text-sm">
            <p className="text-muted-foreground text-xs">
              Both figures are typed. The Admin keeps whatever the lenders do not.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="fixedInterest">Interest the borrower pays</Label>
                <div className="relative">
                  <span className="text-muted-foreground pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm" aria-hidden>
                    ₱
                  </span>
                  <Input
                    id="fixedInterest"
                    name="fixedInterest"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="500"
                    className="money-column pl-7"
                    value={fixedInterest}
                    onChange={(event) => setFixedInterest(event.target.value)}
                    required
                  />
                </div>
                <p className="text-muted-foreground text-xs">
                  The whole amount on top of the capital, for however long it runs.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="fixedLenderShare">Of that, the lenders keep</Label>
                <div className="relative">
                  <span className="text-muted-foreground pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm" aria-hidden>
                    ₱
                  </span>
                  <Input
                    id="fixedLenderShare"
                    name="fixedLenderShare"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="0"
                    className="money-column pl-7"
                    value={fixedLenderShare}
                    onChange={(event) => setFixedLenderShare(event.target.value)}
                    required
                  />
                </div>
                <AdminRemainder interest={fixedInterest} lenderShare={fixedLenderShare} />
              </div>
            </div>
          </div>
        ) : (
          <div className="text-sm">
            {/* THE RATES ARE NOT HIDDEN. They were behind a collapsed <details>
                and a loan went out at 5% instead of 7% without anyone seeing it:
                a field you have to open is a field nobody checks. */}
            <p className="text-muted-foreground text-xs">
              Rates. The usual 7% to the borrower, 2% to the Admin. Change them for this loan only.
            </p>
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
                <Label htmlFor="adminCut">Admin cut, per week</Label>
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
                  The Admin pot earns the whole {borrowerRate || '7'}%, with no one to pay a share to.
                </p>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* ── Whose money ───────────────────────────────────────────────────── */}
      <section className="bg-card space-y-3 rounded-2xl p-4 ring-1 ring-border/70 shadow-rest">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold tracking-tight">Whose money</h2>
          <FundedSoFar funded={preview.funded} remaining={preview.remaining} />
        </div>

        <ul className="space-y-3">
          {rows.map((row) => (
            <li key={row.key} className="space-y-2 rounded-lg border p-3">
              {/* The lender and the amount STACK on a phone. Side by side, a
                  fixed 9rem amount field left the name select about 100px on a
                  narrow handset — "John Ross Santos" showed as "John Ross S…",
                  which is exactly the field you must not have to guess at when
                  you are assigning someone's money. */}
              <div className="flex flex-col gap-2 sm:flex-row">
                <SelectNative
                  name="funderLenderId"
                  aria-label="Lender"
                  value={row.lenderId}
                  onChange={(event) => updateRow(row.key, { lenderId: event.target.value })}
                  className="sm:flex-1"
                >
                  {lenders.map((lender) => (
                    <option key={lender.id} value={lender.id}>
                      {lender.isSelf ? `${lender.name} (Admin pot)` : lender.name}
                    </option>
                  ))}
                  <option value={NEW}>+ Someone new…</option>
                </SelectNative>

                <div className="flex gap-2">
                  <div className="relative flex-1 sm:w-36 sm:flex-none">
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
                      value={amounts.get(row.key) ?? ''}
                      // Clearing the box hands the row back to the autofill rather
                      // than leaving it stuck on an empty amount the admin has to
                      // retype.
                      onChange={(event) =>
                        updateRow(row.key, { amount: event.target.value, touched: event.target.value.trim() !== '' })
                      }
                    />
                  </div>

                  {rows.length > 1 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}
                    >
                      <X className="size-4" aria-hidden />
                      <span className="sr-only">Remove this funder</span>
                    </Button>
                  ) : null}
                </div>
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
              {
                key: Math.max(0, ...current.map((row) => row.key)) + 1,
                lenderId: lenders[0]?.id ?? '',
                amount: '',
                touched: false,
                firstName: '',
                lastName: '',
              },
            ])
          }
        >
          <Plus className="size-4" aria-hidden />
          Add another funder
        </Button>
      </section>

      <Preview capital={preview.capital} interest={preview.interest} total={preview.total} term={preview.term} />

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

/** One of the two ways a loan can charge interest, as a card the admin picks. */
function BasisChoice({
  value,
  current,
  onSelect,
  title,
  hint,
}: {
  value: InterestBasis
  current: InterestBasis
  onSelect: (basis: InterestBasis) => void
  title: string
  hint: string
}) {
  const selected = current === value

  return (
    <label
      className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 ${
        selected ? 'border-brand-line bg-brand-bg' : 'border-border'
      }`}
    >
      <input
        type="radio"
        name="interestBasis"
        value={value}
        checked={selected}
        onChange={() => onSelect(value)}
        className="mt-0.5 size-4 shrink-0"
      />
      <span>
        <span className="block font-medium">{title}</span>
        <span className="text-muted-foreground block text-xs">{hint}</span>
      </span>
    </label>
  )
}

/**
 * What the Admin keeps on a fixed-amount loan.
 *
 * NOTHING IS STORED OR QUERIED HERE. It is the two figures in the boxes above,
 * subtracted — typed interest minus the typed lenders' share — shown so the
 * admin can see the consequence of the second box before saving. The server
 * works the same figure out again from the same two numbers and is what
 * actually decides; this cannot disagree with it because it is the same
 * subtraction, but it is also not the authority.
 */
function AdminRemainder({ interest, lenderShare }: { interest: string; lenderShare: string }) {
  const total = readPesos(interest)
  const lenders = readPesos(lenderShare)

  if (total === null || lenders === null) {
    return (
      <p className="text-muted-foreground text-xs">
        The Admin keeps the rest. Enter 0 if the Admin keeps all of it.
      </p>
    )
  }

  if (lenders > total) {
    return (
      <p className="text-status-critical inline-flex items-start gap-1.5 text-xs font-medium">
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        That is more than the whole interest.
      </p>
    )
  }

  return (
    <p className="text-muted-foreground text-xs">
      The Admin keeps{' '}
      <span className="text-foreground font-medium">{formatPesos(centavos(total - lenders))}</span>.
    </p>
  )
}

/**
 * The live "= 4 weeks" badge, and "= 3 days" on a fixed-amount loan.
 *
 * The spec asks for this by name. On a weekly rate it is also the reason the
 * form refuses dates that do not divide evenly rather than rounding them: a
 * 30-day gap is 4.29 weeks, and rounding it silently moves ₱8,400 of interest to
 * ₱10,500. A fixed amount has no such multiplier, so it takes the dates as they
 * are.
 */
function TermBadge({ basis, term }: { basis: InterestBasis; term: Term | null }) {
  if (term === null) {
    return (
      <p id="term-preview" className="text-muted-foreground text-xs">
        {basis === 'FIXED_AMOUNT' ? 'Any number of days.' : 'Must land on a whole number of weeks.'}
      </p>
    )
  }

  if (term.ok) {
    return (
      <p id="term-preview" className="text-status-good inline-flex items-center gap-1.5 text-sm font-semibold">
        <CircleCheck className="size-4 shrink-0" aria-hidden />= {describeTerm(term.days)}
      </p>
    )
  }

  return (
    <p id="term-preview" className="text-status-critical inline-flex items-start gap-1.5 text-xs font-medium">
      <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      {term.message}
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
  term,
}: {
  capital: Centavos | null
  interest: Centavos | null
  total: Centavos | null
  term: Term | null
}) {
  if (capital === null || interest === null || total === null || !term?.ok) {
    return (
      <div className="text-muted-foreground bg-card/60 border-border rounded-2xl border border-dashed p-4 text-center text-sm">
        Fill in the capital and both dates to see what is owed.
      </div>
    )
  }

  return (
    <div className="bg-brand-bg ring-brand-line rounded-2xl p-4 ring-1">
      <dl className="grid grid-cols-3 gap-3 text-center">
        <div>
          <dt className="text-muted-foreground text-xs">Capital</dt>
          <dd className="mt-0.5 text-sm font-medium">
            <Money amount={capital} variant="display" />
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">Interest · {describeTerm(term.days)}</dt>
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
