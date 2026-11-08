'use client'

import { useActionState, useEffect, useRef } from 'react'

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

/** Create (no planId) or edit (planId) a plan. Rate and cut start from history, then are the Admin's. */
export function PlanForm({ planId, values, defaultsNote }: { planId: string | null; values: PlanDefaults; defaultsNote: string }) {
  const [state, action] = useActionState(planId ? updatePlan : createPlan, NO_ERROR)
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      {planId ? <input type="hidden" name="planId" value={planId} /> : null}
      <Field label="Plan name"><Input name="name" defaultValue={values.name} required maxLength={60} /></Field>
      <Field label="New loans each month"><Input name="newLoansPerMonth" type="number" min={0} max={MAX_LOANS_PER_MONTH} defaultValue={values.newLoansPerMonth} /></Field>
      <Field label="Amount of each loan (₱)"><Input name="loanAmount" inputMode="decimal" defaultValue={values.loanAmount} /></Field>
      <Field label="Length (weeks)"><Input name="termWeeks" type="number" min={1} max={52} defaultValue={values.termWeeks} /></Field>
      <Field label="Rate charged per week (%)"><Input name="borrowerRate" inputMode="decimal" defaultValue={values.borrowerRate} /></Field>
      <Field label="Admin cut per week (%)"><Input name="adminCut" inputMode="decimal" defaultValue={values.adminCut} /></Field>
      <Field label="Interest collected">
        <SelectNative name="interestCollection" defaultValue={values.interestCollection}>
          <option value="AT_END">At the end</option>
          <option value="WEEKLY">Every week</option>
        </SelectNative>
      </Field>
      <Field label="Months ahead"><Input name="horizonMonths" type="number" min={1} max={MAX_HORIZON_MONTHS} defaultValue={values.horizonMonths} /></Field>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" name="relend" defaultChecked={values.relend} />
        Re-lend returned money the way each lender has been doing it (off: it stays as cash)
      </label>
      <p className="text-muted-foreground text-xs sm:col-span-2">{defaultsNote}</p>
      {state.error ? <p role="alert" className="text-status-critical text-sm sm:col-span-2">{state.error}</p> : null}
      {/* A fresh success object (not NO_ERROR) means this form was just saved. */}
      {state !== NO_ERROR && state.error === null ? <p role="status" className="text-sm sm:col-span-2">Saved.</p> : null}
      <button type="submit" className="bg-brand text-brand-foreground rounded-lg px-4 py-2 text-sm font-medium sm:col-span-2">
        {planId ? 'Save plan' : 'Create plan'}
      </button>
    </form>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
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
    <form ref={form} action={action} className="grid gap-2 sm:grid-cols-3">
      <input type="hidden" name="planId" value={planId} />
      <SelectNative name="lenderId" aria-label="Lender">{lenders.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</SelectNative>
      <SelectNative name="type" aria-label="Adds or takes out">
        <option value="DEPOSIT">Adds</option>
        <option value="WITHDRAWAL">Takes out</option>
      </SelectNative>
      <Input name="amount" inputMode="decimal" placeholder="₱ amount" aria-label="Amount" />
      <Input name="fromMonth" type="month" aria-label="From month" />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="everyMonth" /> Every month</label>
      <Input name="untilMonth" type="month" aria-label="Until month (optional)" />
      {state.error ? <p role="alert" className="text-status-critical text-sm sm:col-span-3">{state.error}</p> : null}
      <button type="submit" className="text-brand text-sm font-medium sm:col-span-3">Add planned money move</button>
    </form>
  )
}

export function RemoveMoveButton({ moveId }: { moveId: string }) {
  const [, action] = useActionState(removeMove, NO_ERROR)
  return (
    <form action={action}>
      <input type="hidden" name="moveId" value={moveId} />
      <button type="submit" className="text-muted-foreground text-xs">Remove</button>
    </form>
  )
}

export function DeletePlanButton({ planId, name }: { planId: string; name: string }) {
  const [, action] = useActionState(deletePlan, NO_ERROR)
  return (
    <form action={action} onSubmit={(e) => { if (!confirm(`Delete the plan “${name}”? This cannot be undone.`)) e.preventDefault() }}>
      <input type="hidden" name="planId" value={planId} />
      <button type="submit" className="text-status-critical text-sm">Delete plan</button>
    </form>
  )
}
