'use client'

import { useActionState, useEffect, useRef } from 'react'

import { SubmitButton } from '@/components/forms.tsx'
import { MoneyInput } from '@/components/money-input.tsx'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SelectNative } from '@/components/ui/select-native.tsx'
import { NO_ERROR } from '@/lib/form-state.ts'
import { MAX_HORIZON_MONTHS, MAX_LOANS_PER_MONTH } from '@/lib/money/forecast.ts'
import { addMove, createPlan, deletePlan, removeMove, updatePlan } from '@/server/projections/actions.ts'

export type PlanDefaults = {
  name: string
  newLoansPerMonth: number
  /** Pesos, as typed: "30000". */
  loanAmount: string
  termWeeks: number
  /** Percent, as typed: "7". */
  borrowerRate: string
  adminCut: string
  interestCollection: 'AT_END' | 'WEEKLY'
  relend: boolean
  horizonMonths: number
}

/**
 * Create (no planId) or edit (planId) a plan. Rate and cut start from history, then are the Admin's.
 *
 * Grouped into three plain questions — what new loans, what they charge, how far
 * ahead — each field with one line saying what it does, so the form can be filled
 * in without knowing how the estimate works.
 */
export function PlanForm({ planId, values, defaultsNote }: { planId: string | null; values: PlanDefaults; defaultsNote: string }) {
  const [state, action] = useActionState(planId ? updatePlan : createPlan, NO_ERROR)
  return (
    <form action={action} className="space-y-5">
      {planId ? <input type="hidden" name="planId" value={planId} /> : null}

      <Field label="Plan name" hint="Anything that helps you tell plans apart, e.g. “2 loans a month”.">
        <Input id="name" name="name" defaultValue={values.name} required maxLength={60} placeholder="e.g. Steady growth" />
      </Field>

      <Group title="New loans you expect to make" hint="Pretend loans, added from next month. Nothing is recorded.">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Loans each month">
            <Input id="newLoansPerMonth" name="newLoansPerMonth" type="number" inputMode="numeric" min={0} max={MAX_LOANS_PER_MONTH} defaultValue={values.newLoansPerMonth} />
          </Field>
          <Field label="Weeks each loan runs">
            <Input id="termWeeks" name="termWeeks" type="number" inputMode="numeric" min={1} max={52} defaultValue={values.termWeeks} />
          </Field>
        </div>
        <MoneyInput name="loanAmount" label="Amount of each loan" defaultValue={values.loanAmount} required={false} />
        <p className="text-muted-foreground -mt-1 text-xs">Leave blank if you set 0 loans a month.</p>
      </Group>

      <Group title="What they charge" hint={defaultsNote}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Rate per week (%)">
            <Input id="borrowerRate" name="borrowerRate" inputMode="decimal" defaultValue={values.borrowerRate} />
          </Field>
          <Field label="Admin cut per week (%)">
            <Input id="adminCut" name="adminCut" inputMode="decimal" defaultValue={values.adminCut} />
          </Field>
        </div>
        <Field label="Interest is collected">
          <SelectNative id="interestCollection" name="interestCollection" defaultValue={values.interestCollection}>
            <option value="AT_END">At the end, with the loan</option>
            <option value="WEEKLY">Every week</option>
          </SelectNative>
        </Field>
      </Group>

      <Group title="How far ahead">
        <Field label="Months to show" hint={`1 to ${MAX_HORIZON_MONTHS}.`}>
          <Input id="horizonMonths" name="horizonMonths" type="number" inputMode="numeric" min={1} max={MAX_HORIZON_MONTHS} defaultValue={values.horizonMonths} />
        </Field>
        <label className="bg-muted/50 flex items-start gap-3 rounded-xl p-3 text-sm">
          <input type="checkbox" name="relend" defaultChecked={values.relend} className="mt-0.5 size-4 shrink-0" />
          <span>
            <span className="font-medium">Lend returned money out again</span>
            <span className="text-muted-foreground block text-xs">
              Each lender re-lends the way they have been doing. This can make the numbers grow very fast — the page shows them without it too.
            </span>
          </span>
        </label>
      </Group>

      {state.error ? <p role="alert" className="text-status-critical text-sm">{state.error}</p> : null}
      {/* A fresh success object (not NO_ERROR) means this form was just saved. */}
      {state !== NO_ERROR && state.error === null ? <p role="status" className="text-sm font-medium">Saved.</p> : null}
      <SubmitButton size="lg" className="w-full" pendingLabel="Saving…">{planId ? 'Save changes' : 'Create plan'}</SubmitButton>
    </form>
  )
}

function Group({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-semibold">{title}</legend>
      {hint ? <p className="text-muted-foreground -mt-2 text-xs">{hint}</p> : null}
      {children}
    </fieldset>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactElement<{ id?: string }> }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={children.props.id}>{label}</Label>
      {children}
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </div>
  )
}

/** One planned deposit or withdrawal. Pretend money: never recorded as a transaction. */
export function AddMoveForm({ planId, lenders }: { planId: string; lenders: { id: string; name: string }[] }) {
  const [state, action] = useActionState(addMove, NO_ERROR)
  const form = useRef<HTMLFormElement>(null)
  // Added: clear the fields for the next one. Errors keep what was typed.
  useEffect(() => {
    if (state !== NO_ERROR && state.error === null) form.current?.reset()
  }, [state])
  return (
    <form ref={form} action={action} className="space-y-3">
      <input type="hidden" name="planId" value={planId} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Lender">
          <SelectNative id="move-lender" name="lenderId">{lenders.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</SelectNative>
        </Field>
        <Field label="Puts in or takes out">
          <SelectNative id="move-type" name="type">
            <option value="DEPOSIT">Puts money in</option>
            <option value="WITHDRAWAL">Takes money out</option>
          </SelectNative>
        </Field>
      </div>
      <MoneyInput name="amount" label="Amount" />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Month">
          <Input id="move-from" name="fromMonth" type="month" required />
        </Field>
        <Field label="Last month" hint="Only if it repeats. Blank: to the end.">
          <Input id="move-until" name="untilMonth" type="month" />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="everyMonth" className="size-4" /> Repeat every month
      </label>
      {state.error ? <p role="alert" className="text-status-critical text-sm">{state.error}</p> : null}
      <SubmitButton variant="secondary" className="w-full" pendingLabel="Adding…">Add money move</SubmitButton>
    </form>
  )
}

export function RemoveMoveButton({ moveId }: { moveId: string }) {
  const [, action] = useActionState(removeMove, NO_ERROR)
  return (
    <form action={action}>
      <input type="hidden" name="moveId" value={moveId} />
      <button type="submit" className="text-muted-foreground hover:text-foreground -m-2 p-2 text-xs underline-offset-2 hover:underline">Remove</button>
    </form>
  )
}

export function DeletePlanButton({ planId, name }: { planId: string; name: string }) {
  const [, action] = useActionState(deletePlan, NO_ERROR)
  return (
    <form action={action} onSubmit={(e) => { if (!confirm(`Delete the plan “${name}”? This cannot be undone.`)) e.preventDefault() }}>
      <input type="hidden" name="planId" value={planId} />
      <button type="submit" className="text-status-critical text-sm font-medium">Delete this plan</button>
    </form>
  )
}
