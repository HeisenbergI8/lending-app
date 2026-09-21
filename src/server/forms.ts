import { type Centavos, parsePesos } from '../lib/money/centavos.ts'
import { type Result, ok, err } from '../lib/money/result.ts'
import { parseCalendarDate } from '../lib/money/weeks.ts'

// The shape itself lives in lib/ so client components can read it without
// importing anything server-only. See src/lib/form-state.ts.
export { type FormState, NO_ERROR, failed } from '../lib/form-state.ts'

/** A trimmed text field. Empty string when absent — never null, never "undefined". */
export function text(form: FormData, key: string): string {
  return String(form.get(key) ?? '').trim()
}

/**
 * A peso amount typed by a person, as centavos.
 *
 * The error strings are written for the admin, not for a log: they say what to do
 * about it. parsePesos refuses more than two decimals rather than rounding them
 * away — if someone typed ₱100.005 they meant something, and dropping it quietly
 * is how a ledger stops matching.
 */
export function amount(form: FormData, key: string): Result<Centavos, string> {
  const parsed = parsePesos(text(form, key))
  if (parsed.ok) {
    if (parsed.value <= 0) return err('Enter an amount greater than zero.')
    return parsed
  }

  switch (parsed.error.kind) {
    case 'empty':
      return err('Enter an amount.')
    case 'negative':
      return err('Enter an amount greater than zero.')
    case 'too-many-decimals':
      return err('Amounts go to centavos — two decimal places at most.')
    case 'too-large':
      return err('That amount is too large to record.')
    default:
      return err('Enter an amount in pesos, like 30000 or 30,000.50.')
  }
}

/**
 * A date typed into <input type="date">, which arrives as "2026-09-21".
 *
 * Handed to calendarDate before it goes anywhere near the database — see the
 * comment there for why a date built at local midnight is stored as the day
 * before. This is one of the three places a calendar day enters the app.
 */
export function date(form: FormData, key: string): Result<Date, string> {
  const raw = text(form, key)
  if (!raw) return err('Pick a date.')

  // parseCalendarDate carries the midday rule AND the check that the day really
  // exists — new Date(2026, 1, 31) is 3 March rather than an error.
  const parsed = parseCalendarDate(raw)
  if (!parsed) return err(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? 'That date does not exist.' : 'Pick a date.')

  return ok(parsed)
}

/** A person's name. Both halves are required; nothing else about them is stored. */
export function personName(form: FormData): Result<{ firstName: string; lastName: string }, string> {
  const firstName = text(form, 'firstName')
  const lastName = text(form, 'lastName')
  if (!firstName || !lastName) return err('Enter a first and last name.')
  if (firstName.length > 80 || lastName.length > 80) return err('That name is too long.')
  return ok({ firstName, lastName })
}
