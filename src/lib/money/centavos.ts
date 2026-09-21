/**
 * Money, as a whole number of centavos.
 *
 * ₱30,000.00 is 3_000_000. Never a decimal, never a float.
 *
 * The app multiplies capital by a percentage and splits the result between
 * funders — exactly the operation where binary floating point loses fractions.
 * `0.1 + 0.2 !== 0.3` is the toy example; the real one is a lender quietly
 * receiving ₱3,999.99 instead of ₱4,000 and nothing reconciling at the end of
 * the month.
 *
 * `Centavos` is a branded number: structurally it is a number, but TypeScript
 * will not let a plain number be passed where centavos are expected. That stops
 * the mistake this whole file exists to prevent — passing 30_000 (pesos) where
 * 3_000_000 (centavos) was meant.
 */

import { type Result, ok, err } from './result.ts'

declare const centavosBrand: unique symbol

export type Centavos = number & { readonly [centavosBrand]: 'Centavos' }

/** Basis points. 7% is 700, 5% is 500. Integers, for the same reason as centavos. */
export type BasisPoints = number

export const BPS_DENOMINATOR = 10_000

/**
 * Multiplying capital × rate × weeks produces a large intermediate. Above
 * Number.MAX_SAFE_INTEGER a `number` silently stops being exact, which would
 * defeat the point of integer money. Every multiplication in this module is
 * checked against this rather than assumed to fit.
 */
export const MAX_SAFE = Number.MAX_SAFE_INTEGER

export type MoneyParseError =
  | { kind: 'empty' }
  | { kind: 'not-a-number'; input: string }
  | { kind: 'too-many-decimals'; input: string; decimals: number }
  | { kind: 'negative'; input: string }
  | { kind: 'too-large'; input: string }

/** Assert an integer is really a whole number of centavos, and brand it. */
export function centavos(amount: number): Centavos {
  if (!Number.isInteger(amount)) {
    throw new Error(`Centavos must be a whole number, got ${amount}`)
  }
  if (!Number.isSafeInteger(amount)) {
    throw new Error(`Centavos out of safe integer range: ${amount}`)
  }
  return amount as Centavos
}

export const ZERO: Centavos = centavos(0)

/**
 * Parse what a person typed into centavos.
 *
 * Accepts "30000", "30,000", "₱30,000.50", " 30000.5 ". Rejects more than two
 * decimal places rather than rounding them away: if someone typed 30000.005 they
 * meant something, and silently dropping it is how a ledger stops matching.
 */
export function parsePesos(input: string): Result<Centavos, MoneyParseError> {
  const cleaned = input.replace(/[₱,\s]/g, '')
  if (cleaned === '') return err({ kind: 'empty' })
  if (cleaned.startsWith('-')) return err({ kind: 'negative', input })
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return err({ kind: 'not-a-number', input })

  const [whole, fraction = ''] = cleaned.split('.')
  if (fraction.length > 2) {
    return err({ kind: 'too-many-decimals', input, decimals: fraction.length })
  }

  const total = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  if (!Number.isSafeInteger(total)) return err({ kind: 'too-large', input })

  return ok(centavos(total))
}

/** "₱30,000.00" — for display only. Never parse this back with anything but parsePesos. */
export function formatPesos(amount: Centavos): string {
  const negative = amount < 0
  const abs = Math.abs(amount)
  const whole = Math.floor(abs / 100)
  const fraction = abs % 100
  const grouped = whole.toLocaleString('en-PH')
  return `${negative ? '-' : ''}₱${grouped}.${String(fraction).padStart(2, '0')}`
}

/** Plain number of pesos, for a chart axis or a CSV cell. Lossy below one centavo — never for arithmetic. */
export function toPesos(amount: Centavos): number {
  return amount / 100
}

export function addCentavos(...amounts: Centavos[]): Centavos {
  return centavos(amounts.reduce<number>((sum, n) => sum + n, 0))
}

export function subtractCentavos(a: Centavos, b: Centavos): Centavos {
  return centavos(a - b)
}

/** Guard a multiplication before it silently loses precision. */
export function checkedProduct(...factors: number[]): number {
  const product = factors.reduce((acc, n) => acc * n, 1)
  if (!Number.isSafeInteger(product)) {
    throw new Error(
      `Money calculation exceeded safe integer range (${factors.join(' x ')} = ${product}). ` +
        `The loan is too large for this arithmetic.`,
    )
  }
  return product
}
