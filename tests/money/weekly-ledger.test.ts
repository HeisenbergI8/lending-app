import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { centavos } from '../../src/lib/money/centavos.ts'
import { type LenderLedger, EMPTY_LEDGER, lenderPosition } from '../../src/lib/money/floating.ts'
import { splitLoan } from '../../src/lib/money/split.ts'
import {
  consecutivePaidWeeks,
  realisedThrough,
  releasedOnFunding,
  weeklySchedule,
  weeklySlices,
} from '../../src/lib/money/weekly.ts'

/**
 * What a collected week does to the pots.
 *
 * `ledgers()` in server/lenders/queries.ts needs a database, so what is proved
 * here is the arithmetic it performs: a funding row split at the line between
 * weeks collected and weeks still owed, fed through the SAME lenderPosition the
 * app calls. That function is not changed by this feature, and this file is the
 * evidence that it did not need to be — the four sentences FEATURES.md section
 * 5 promises fall out of feeding it better inputs.
 */

const peso = (n: number) => centavos(n * 100)

// 60,000 at 7% for 20 weeks, funded by one lender. ₱4,200 a week: ₱3,000 to the
// lender, ₱1,200 to the Admin.
const WEEKS = 20
const split = splitLoan({
  capital: peso(60_000),
  borrowerRateBps: 700,
  weeks: WEEKS,
  fundings: [{ lenderId: 'john', principal: peso(60_000), lenderRateBps: 500, adminCutBps: 200 }],
})
if (!split.ok) throw new Error('the fixture loan should split')
const funding = split.value.lenders[0]

/** The first `n` weeks, as the set of week numbers the server passes around. */
const firstWeeks = (n: number) => new Set(Array.from({ length: n }, (_unused, index) => index + 1))

/**
 * The lender's own ledger with these weeks collected, built the way ledgers() does.
 *
 * Through releasedOnFunding and a SET of week numbers, which is what
 * server/lenders/queries.ts actually calls. It used to go through realisedThrough
 * and a count — which agrees for a contiguous run, so the suite stayed green
 * while nothing tested a lender's Floating under a skipped week. That was the
 * case the whole fix was about.
 */
function lenderLedgerFor(paidWeeks: ReadonlySet<number>): LenderLedger {
  const { earnings } = releasedOnFunding(
    { earnings: funding.earnings, adminCut: funding.adminCut },
    WEEKS,
    paidWeeks,
  )
  return {
    ...EMPTY_LEDGER,
    deposits: peso(100_000),
    // The capital stays OUT until the loan is paid, however many weeks landed.
    activePrincipal: funding.principal,
    settledEarnings: earnings,
    pendingEarnings: centavos(funding.earnings - earnings),
  }
}

/** The Admin's ledger for these weeks — their cut only, on somebody else's capital. */
function adminLedgerFor(paidWeeks: ReadonlySet<number>): LenderLedger {
  const { adminCut } = releasedOnFunding(
    { earnings: funding.earnings, adminCut: funding.adminCut },
    WEEKS,
    paidWeeks,
  )
  return {
    ...EMPTY_LEDGER,
    settledAdminCuts: adminCut,
    pendingAdminCuts: centavos(funding.adminCut - adminCut),
  }
}

const lenderLedgerAfter = (paid: number) => lenderLedgerFor(firstWeeks(paid))
const adminLedgerAfter = (paid: number) => adminLedgerFor(firstWeeks(paid))

describe('a collected week moves money, a running loan does not', () => {
  test('before any week is collected, nothing has arrived', () => {
    const position = lenderPosition(lenderLedgerAfter(0))
    assert.equal(position.earned, peso(0))
    assert.equal(position.pending, peso(60_000 * 0.05 * WEEKS))
    assert.equal(position.outOnLoan, peso(60_000))
    assert.equal(position.floating, peso(40_000)) // 100,000 in, 60,000 out
  })

  test('each collected week raises floating by exactly that week', () => {
    for (let paid = 1; paid <= WEEKS - 1; paid += 1) {
      const before = lenderPosition(lenderLedgerAfter(paid - 1))
      const after = lenderPosition(lenderLedgerAfter(paid))
      assert.equal(after.floating - before.floating, peso(3_000), `week ${paid}`)
      assert.equal(after.earned - before.earned, peso(3_000), `week ${paid}`)
    }
  })

  test('OUT ON LOAN HOLDS STEADY while the interest climbs', () => {
    // The sentence the feature exists to make true.
    for (let paid = 0; paid <= WEEKS; paid += 1) {
      assert.equal(lenderPosition(lenderLedgerAfter(paid)).outOnLoan, peso(60_000), `week ${paid}`)
    }
  })

  test('earned and pending always add back up to what the lender is owed', () => {
    for (let paid = 0; paid <= WEEKS; paid += 1) {
      const position = lenderPosition(lenderLedgerAfter(paid))
      assert.equal(position.earned + position.pending, funding.earnings, `week ${paid}`)
    }
  })

  test("the Admin's cut follows the same line, week for week", () => {
    for (let paid = 0; paid <= WEEKS; paid += 1) {
      const position = lenderPosition(adminLedgerAfter(paid))
      assert.equal(position.adminCutEarned + position.adminCutPending, funding.adminCut)
    }
    assert.equal(lenderPosition(adminLedgerAfter(5)).adminCutEarned, peso(6_000)) // 5 x 1,200
  })

  test('what is released never exceeds what the schedule collected', () => {
    const schedule = weeklySchedule(
      [{ lenderId: funding.lenderId, earnings: funding.earnings, adminCut: funding.adminCut }],
      WEEKS,
    )
    for (let paid = 0; paid <= WEEKS; paid += 1) {
      const collected = schedule.slice(0, paid).reduce<number>((sum, week) => sum + week.interest, 0)
      const released =
        realisedThrough(funding.earnings, WEEKS, paid) + realisedThrough(funding.adminCut, WEEKS, paid)
      assert.equal(released, collected, `week ${paid}`)
    }
  })
})

describe('A GAP IN THE WEEKS IS COUNTED EXACTLY, not approximated', () => {
  // A gap is ordinary, not exotic: converting a loan records the weeks that
  // really were paid, and undoing a week recorded by mistake leaves one in the
  // middle.
  //
  // This used to take the UNBROKEN RUN and multiply, which understated — and
  // understated in one place and not another, so the loan page and the loans
  // list reported different collected figures for the same loan. releasedOnFunding
  // now sums the weeks actually paid.
  const released = (paid: number[]) =>
    releasedOnFunding({ earnings: funding.earnings, adminCut: funding.adminCut }, WEEKS, new Set(paid))

  test('weeks 1 and 3 paid releases TWO weeks, not one', () => {
    assert.equal(released([1, 3]).earnings, peso(6_000))
    assert.equal(released([1, 3]).adminCut, peso(2_400))
    // The unbroken run is still 1, and is still the honest answer to a DIFFERENT
    // question — how far the borrower got without missing one.
    assert.equal(consecutivePaidWeeks(WEEKS, new Set([1, 3])), 1)
  })

  test('every gap shape releases exactly what those weeks were worth', () => {
    const gaps: number[][] = [[1, 3], [2, 3], [1, 2, 5, 6], [3], [1, 2, 3, 7, 8], [19], []]
    for (const paid of gaps) {
      assert.equal(
        released(paid).earnings,
        peso(3_000) * paid.length,
        `${paid.join(',') || 'none'}: not what those weeks were worth`,
      )
    }
  })

  test('it agrees with adding the slices up, gap or no gap', () => {
    const slices = weeklySlices(funding.earnings, WEEKS)
    const gaps: number[][] = [[1, 3], [1, 2, 3], [4, 8, 12], [20], [1, 20]]
    for (const paid of gaps) {
      const summed = paid.reduce((total, week) => total + slices[week - 1], 0)
      assert.equal(released(paid).earnings, summed, paid.join(','))
    }
  })

  test('every week paid releases the whole stored total, to the centavo', () => {
    const all = Array.from({ length: WEEKS }, (_unused, index) => index + 1)
    assert.equal(released(all).earnings, funding.earnings)
    assert.equal(released(all).adminCut, funding.adminCut)
  })

  test('a week outside the term releases nothing for itself', () => {
    assert.equal(released([1, 999]).earnings, peso(3_000))
    assert.equal(released([0, 1]).earnings, peso(3_000))
  })
})

describe("A LENDER'S POTS UNDER A SKIPPED WEEK", () => {
  // The case the post-audit fix was about, and the one the live demo loan is in.
  // Nothing tested it before, because the fixtures went through a count and a
  // count cannot tell weeks 1,2 from weeks 1,3.
  const gap = new Set([1, 2, 4, 5]) // week 3 missed: four weeks of money

  test('four collected weeks release four weeks, gap or no gap', () => {
    const position = lenderPosition(lenderLedgerFor(gap))
    assert.equal(position.earned, peso(12_000)) // 4 x 3,000
    assert.equal(position.pending, centavos(funding.earnings - peso(12_000)))
  })

  test('it matches five contiguous weeks minus the one that was missed', () => {
    const withGap = lenderPosition(lenderLedgerFor(gap))
    const contiguous = lenderPosition(lenderLedgerAfter(5))
    assert.equal(contiguous.earned - withGap.earned, peso(3_000), 'exactly the missed week')
  })

  test('the capital is still out, and floating moved by the four weeks only', () => {
    const position = lenderPosition(lenderLedgerFor(gap))
    assert.equal(position.outOnLoan, peso(60_000))
    assert.equal(position.floating, peso(40_000 + 12_000))
  })

  test("the Admin's cut follows the same weeks", () => {
    const position = lenderPosition(adminLedgerFor(gap))
    assert.equal(position.adminCutEarned, peso(4_800)) // 4 x 1,200
    assert.equal(position.adminCutEarned + position.adminCutPending, funding.adminCut)
  })

  test('earned and pending still add back up, with a gap', () => {
    const position = lenderPosition(lenderLedgerFor(gap))
    assert.equal(position.earned + position.pending, funding.earnings)
  })
})
