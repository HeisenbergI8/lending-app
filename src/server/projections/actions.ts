'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { type Result, err, ok } from '../../lib/money/result.ts'
import { MAX_HORIZON_MONTHS, MAX_LOANS_PER_MONTH } from '../../lib/money/forecast.ts'
import { MIN_WEEKLY_WEEKS } from '../../lib/money/weekly.ts'
import { calendarDate, firstOfMonth } from '../../lib/money/weeks.ts'
import { requireUser } from '../auth/guard.ts'
import { db } from '../db.ts'
import { type FormState, NO_ERROR, amount, failed, text } from '../forms.ts'
import { parseRate } from '../loans/terms.ts'

/**
 * Writing saved Projections plans. INPUTS ONLY — nothing here moves money or
 * touches a lender's floating funds; see ProjectionPlan in the schema.
 */

const MAX_TERM_WEEKS = 52
const MAX_INT_CENTAVOS = 2_147_483_647

function refresh(): void {
  revalidatePath('/projections')
  revalidatePath('/') // the dashboard preview
}

function whole(form: FormData, key: string, label: string, min: number, max: number): Result<number, string> {
  const raw = text(form, key)
  const n = Number(raw)
  if (raw === '' || !Number.isInteger(n) || n < min || n > max) return err(`${label} must be a whole number from ${min} to ${max}.`)
  return ok(n)
}

/** "2027-03" from <input type="month"> → 1 March 2027 at midday, through calendarDate. */
function month(form: FormData, key: string): Result<Date, string> {
  const match = /^(\d{4})-(\d{2})$/.exec(text(form, key))
  if (!match) return err('Pick a month.')
  return ok(calendarDate(firstOfMonth(new Date(Number(match[1]), Number(match[2]) - 1, 1, 12))))
}

type PlanFields = {
  name: string
  newLoansPerMonth: number
  loanAmountCentavos: number
  termWeeks: number
  borrowerRateBps: number
  adminCutBps: number
  interestCollection: 'AT_END' | 'WEEKLY'
  relend: boolean
  horizonMonths: number
}

function readPlan(form: FormData): Result<PlanFields, string> {
  const name = text(form, 'name')
  if (name === '' || name.length > 60) return err('Give the plan a name, up to 60 characters.')
  const loans = whole(form, 'newLoansPerMonth', 'New loans a month', 0, MAX_LOANS_PER_MONTH)
  if (!loans.ok) return loans
  const size = amount(form, 'loanAmount')
  if (!size.ok) return size
  if (size.value > MAX_INT_CENTAVOS) return err('A loan that large cannot be recorded.')
  const weeks = whole(form, 'termWeeks', 'Length in weeks', 1, MAX_TERM_WEEKS)
  if (!weeks.ok) return weeks
  const rate = parseRate(text(form, 'borrowerRate'))
  if (!rate.ok) return rate
  const cut = parseRate(text(form, 'adminCut'))
  if (!cut.ok) return cut
  if (cut.value > rate.value) return err('The Admin cut cannot be more than the rate charged.')
  const collection = text(form, 'interestCollection') === 'WEEKLY' ? 'WEEKLY' : 'AT_END'
  if (collection === 'WEEKLY' && weeks.value < MIN_WEEKLY_WEEKS) {
    return err(`Collecting weekly needs a loan of at least ${MIN_WEEKLY_WEEKS} weeks.`)
  }
  const horizon = whole(form, 'horizonMonths', 'Months ahead', 1, MAX_HORIZON_MONTHS)
  if (!horizon.ok) return horizon
  return ok({
    name,
    newLoansPerMonth: loans.value,
    loanAmountCentavos: size.value,
    termWeeks: weeks.value,
    borrowerRateBps: rate.value,
    adminCutBps: cut.value,
    interestCollection: collection,
    relend: text(form, 'relend') === 'on',
    horizonMonths: horizon.value,
  })
}

export async function createPlan(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser()
  const fields = readPlan(form)
  if (!fields.ok) return failed(fields.error)
  const clash = await db.projectionPlan.findFirst({ where: { userId: user.id, name: fields.value.name }, select: { id: true } })
  if (clash) return failed('A plan with that name already exists.')
  const plan = await db.projectionPlan.create({ data: { ...fields.value, userId: user.id }, select: { id: true } })
  refresh()
  redirect(`/projections?plan=${plan.id}`)
}

export async function updatePlan(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser()
  const id = text(form, 'planId')
  const fields = readPlan(form)
  if (!fields.ok) return failed(fields.error)
  const clash = await db.projectionPlan.findFirst({
    where: { userId: user.id, name: fields.value.name, NOT: { id } },
    select: { id: true },
  })
  if (clash) return failed('A plan with that name already exists.')
  const { count } = await db.projectionPlan.updateMany({ where: { id, userId: user.id }, data: fields.value })
  if (count === 0) return failed('That plan no longer exists.')
  refresh()
  return NO_ERROR
}

/** Really deletes — a plan holds no money history. The form asks first. */
export async function deletePlan(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser()
  await db.projectionPlan.deleteMany({ where: { id: text(form, 'planId'), userId: user.id } })
  refresh()
  redirect('/projections')
}

export async function addMove(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser()
  const planId = text(form, 'planId')
  const lenderId = text(form, 'lenderId')
  const [plan, lender] = await Promise.all([
    db.projectionPlan.findFirst({ where: { id: planId, userId: user.id }, select: { id: true } }),
    db.lender.findFirst({ where: { id: lenderId, userId: user.id, deletedAt: null }, select: { id: true } }),
  ])
  if (!plan) return failed('That plan no longer exists.')
  if (!lender) return failed('Pick a lender.')
  const size = amount(form, 'amount')
  if (!size.ok) return failed(size.error)
  const from = month(form, 'fromMonth')
  if (!from.ok) return failed(from.error)
  const everyMonth = text(form, 'everyMonth') === 'on'
  let until: Date | null = null
  if (everyMonth && text(form, 'untilMonth') !== '') {
    const parsed = month(form, 'untilMonth')
    if (!parsed.ok) return failed(parsed.error)
    if (parsed.value.getTime() < from.value.getTime()) return failed('The last month cannot be before the first.')
    until = parsed.value
  }
  await db.projectionMove.create({
    data: {
      userId: user.id,
      planId,
      lenderId,
      type: text(form, 'type') === 'WITHDRAWAL' ? 'WITHDRAWAL' : 'DEPOSIT',
      amountCentavos: size.value,
      fromMonth: from.value,
      everyMonth,
      untilMonth: until,
    },
  })
  refresh()
  return NO_ERROR
}

export async function removeMove(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser()
  await db.projectionMove.deleteMany({ where: { id: text(form, 'moveId'), userId: user.id } })
  refresh()
  return NO_ERROR
}
