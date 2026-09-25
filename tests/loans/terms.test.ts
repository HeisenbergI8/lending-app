import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { centavos } from '../../src/lib/money/centavos.ts'
import { calendarDate } from '../../src/lib/money/weeks.ts'
import { loanTerms, parseRate } from '../../src/server/loans/terms.ts'

const peso = (n: number) => centavos(Math.round(n * 100))
const on = (y: number, m: number, d: number) => calendarDate(new Date(y, m - 1, d))

const base = {
  capital: peso(30_000),
  startOn: on(2026, 2, 1),
  dueOn: on(2026, 3, 1), // 28 days
  interest: { basis: 'WEEKLY_RATE', borrowerRateBps: 700, adminCutBps: 200 },
  // Collected all at once on the due date, which is what every loan in this
  // file describes and what every loan the app made before 2026-09-25 did.
  // The weekly alternative has its own describe block at the end.
  collection: 'AT_END',
} as const

/** The same loan with one rate changed. Keeps the tests reading as one sentence. */
const atRates = (borrowerRateBps: number, adminCutBps: number) =>
  ({ basis: 'WEEKLY_RATE', borrowerRateBps, adminCutBps }) as const

/** A loan charging a typed amount instead: what the borrower pays, and the lenders' share. */
const fixed = (interest: number, lenderInterest: number) =>
  ({ basis: 'FIXED_AMOUNT', interest: peso(interest), lenderInterest: peso(lenderInterest) }) as const

describe("Angel's loan — the worked example, end to end", () => {
  const result = loanTerms({
    ...base,
    funders: [{ lenderId: 'john', isSelf: false, principal: peso(30_000) }],
  })

  test('the dates come out at 4 weeks', () => {
    assert.equal(result.ok, true)
    if (result.ok) assert.equal(result.value.termDays / 7, 4)
  })

  test('she is charged ₱8,400 and repays ₱38,400', () => {
    if (!result.ok) return assert.fail(result.error)
    assert.equal(result.value.interest, peso(8_400))
    assert.equal(result.value.total, peso(38_400))
  })

  test('John Ross earns ₱6,000 and the admin keeps ₱2,400', () => {
    if (!result.ok) return assert.fail(result.error)
    assert.equal(result.value.fundings[0].earnings, peso(6_000))
    assert.equal(result.value.split.adminEarnings, peso(2_400))
  })

  test("the lender's row runs at 5%, with the admin's 2% beside it", () => {
    if (!result.ok) return assert.fail(result.error)
    assert.equal(result.value.fundings[0].lenderRateBps, 500)
    assert.equal(result.value.fundings[0].adminCutBps, 200)
  })
})

describe('split between two lenders', () => {
  const result = loanTerms({
    ...base,
    funders: [
      { lenderId: 'maria', isSelf: false, principal: peso(20_000) },
      { lenderId: 'jun', isSelf: false, principal: peso(10_000) },
    ],
  })

  test('each earns 5% on their own share', () => {
    if (!result.ok) return assert.fail(result.error)
    const byLender = Object.fromEntries(result.value.fundings.map((f) => [f.lenderId, f]))
    assert.equal(byLender.maria.earnings, peso(4_000))
    assert.equal(byLender.jun.earnings, peso(2_000))
  })

  test('the parts still add up to the ₱8,400 charged', () => {
    if (!result.ok) return assert.fail(result.error)
    const earned = result.value.fundings.reduce((sum, f) => sum + f.earnings, 0)
    assert.equal(earned + result.value.split.adminEarnings, result.value.interest)
  })
})

describe("the admin's own money is not a special case", () => {
  const result = loanTerms({
    ...base,
    funders: [
      { lenderId: 'admin', isSelf: true, principal: peso(10_000) },
      { lenderId: 'john', isSelf: false, principal: peso(20_000) },
    ],
  })

  test('their own capital earns the full 7% and pays no cut', () => {
    if (!result.ok) return assert.fail(result.error)
    const admin = result.value.fundings.find((f) => f.lenderId === 'admin')
    assert.equal(admin?.lenderRateBps, 700)
    assert.equal(admin?.adminCutBps, 0)
    assert.equal(admin?.earnings, peso(2_800))
    assert.equal(admin?.adminCut, 0)
  })

  test("they still take 2% on the lender's half — ₱1,600", () => {
    if (!result.ok) return assert.fail(result.error)
    assert.equal(result.value.split.adminEarnings, peso(1_600))
  })

  test('₱4,400 to the admin, ₱4,000 to John Ross, ₱8,400 in total', () => {
    if (!result.ok) return assert.fail(result.error)
    const john = result.value.fundings.find((f) => f.lenderId === 'john')
    const adminOwn = result.value.fundings.find((f) => f.lenderId === 'admin')
    assert.equal(adminOwn!.earnings + result.value.split.adminEarnings, peso(4_400))
    assert.equal(john?.earnings, peso(4_000))
    assert.equal(result.value.interest, peso(8_400))
  })
})

describe('the date rule refuses rather than rounds', () => {
  const funders = [{ lenderId: 'john', isSelf: false, principal: peso(30_000) }]

  test('30 days is refused, and the message names the two dates that work', () => {
    const result = loanTerms({ ...base, dueOn: on(2026, 3, 3), funders })
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.match(result.error, /30 days is not a whole number of weeks/)
      // The same date format the screens use, so the suggestion reads like the
      // rest of the app rather than like an error string.
      assert.match(result.error, /Mar 1, 2026/)
      assert.match(result.error, /Mar 8, 2026/)
    }
  })

  test('a due date before the start is refused', () => {
    const result = loanTerms({ ...base, dueOn: on(2026, 1, 25), funders })
    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.error, /before the start date/)
  })

  test('same day is refused — a loan runs at least a week', () => {
    const result = loanTerms({ ...base, dueOn: base.startOn, funders })
    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.error, /at least one week/)
  })

  test('every whole-week gap from 1 to 52 is accepted', () => {
    for (let weeks = 1; weeks <= 52; weeks += 1) {
      const dueOn = on(2026, 2, 1 + weeks * 7)
      const result = loanTerms({ ...base, dueOn, funders })
      assert.equal(result.ok, true, `${weeks} weeks should be accepted`)
      if (result.ok) assert.equal(result.value.termDays / 7, weeks)
    }
  })
})

describe('the funding has to add up', () => {
  test('short funding says by how much', () => {
    const result = loanTerms({
      ...base,
      funders: [{ lenderId: 'john', isSelf: false, principal: peso(25_000) }],
    })
    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.error, /₱5,000\.00 short/)
  })

  test('over-funding says by how much too', () => {
    const result = loanTerms({
      ...base,
      funders: [{ lenderId: 'john', isSelf: false, principal: peso(31_500) }],
    })
    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.error, /₱1,500\.00 more/)
  })

  test('no funders at all is refused', () => {
    const result = loanTerms({ ...base, funders: [] })
    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.error, /whose money/)
  })

  test('the same lender twice is refused rather than silently merged', () => {
    const result = loanTerms({
      ...base,
      funders: [
        { lenderId: 'john', isSelf: false, principal: peso(15_000) },
        { lenderId: 'john', isSelf: false, principal: peso(15_000) },
      ],
    })
    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.error, /listed twice/)
  })
})

describe('the rates', () => {
  const funders = [{ lenderId: 'john', isSelf: false, principal: peso(30_000) }]

  test('a cut larger than the borrower rate is refused', () => {
    const result = loanTerms({ ...base, interest: atRates(200, 700), funders })
    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.error, /cannot be larger/)
  })

  test('a zero cut is fine — the lender simply takes the whole rate', () => {
    const result = loanTerms({ ...base, interest: atRates(700, 0), funders })
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.equal(result.value.fundings[0].lenderRateBps, 700)
      assert.equal(result.value.split.adminEarnings, 0)
    }
  })

  test('the cut is per loan, not global — 3% works as readily as 2%', () => {
    const result = loanTerms({ ...base, interest: atRates(700, 300), funders })
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.equal(result.value.fundings[0].earnings, peso(4_800)) // 30,000 x 4% x 4
      assert.equal(result.value.split.adminEarnings, peso(3_600)) // 30,000 x 3% x 4
    }
  })
})


describe('a fixed amount of interest, for the loans no rate describes', () => {
  // Angel borrows ₱3,000 over three days for ₱500, of which the lender keeps
  // ₱300. Three days is not a whole number of weeks and ₱500 is not 7% of
  // anything, which is the whole reason this basis exists.
  const threeDays = {
    capital: peso(3_000),
    startOn: on(2026, 2, 1),
    dueOn: on(2026, 2, 4),
    collection: 'AT_END',
  } as const

  test('three days is accepted, where a weekly rate would refuse it', () => {
    const result = loanTerms({
      ...threeDays,
      interest: fixed(500, 300),
      funders: [{ lenderId: 'john', isSelf: false, principal: peso(3_000) }],
    })
    assert.equal(result.ok, true)
    if (result.ok) assert.equal(result.value.termDays, 3)
  })

  test('the borrower repays ₱3,500 — the typed amount, nothing derived', () => {
    const result = loanTerms({
      ...threeDays,
      interest: fixed(500, 300),
      funders: [{ lenderId: 'john', isSelf: false, principal: peso(3_000) }],
    })
    if (!result.ok) return assert.fail(result.error)
    assert.equal(result.value.interest, peso(500))
    assert.equal(result.value.total, peso(3_500))
  })

  test('the lender keeps ₱300 and the admin the other ₱200', () => {
    const result = loanTerms({
      ...threeDays,
      interest: fixed(500, 300),
      funders: [{ lenderId: 'john', isSelf: false, principal: peso(3_000) }],
    })
    if (!result.ok) return assert.fail(result.error)
    assert.equal(result.value.fundings[0].earnings, peso(300))
    assert.equal(result.value.fundings[0].adminCut, peso(200))
    assert.equal(result.value.split.adminEarnings, peso(200))
  })

  test('no rate is recorded, because none was used', () => {
    const result = loanTerms({
      ...threeDays,
      interest: fixed(500, 300),
      funders: [{ lenderId: 'john', isSelf: false, principal: peso(3_000) }],
    })
    if (!result.ok) return assert.fail(result.error)
    assert.equal(result.value.fundings[0].lenderRateBps, null)
    assert.equal(result.value.fundings[0].adminCutBps, null)
  })

  test("the lenders' share splits between them by what each put in", () => {
    const result = loanTerms({
      ...threeDays,
      interest: fixed(500, 300),
      funders: [
        { lenderId: 'maria', isSelf: false, principal: peso(2_000) },
        { lenderId: 'jun', isSelf: false, principal: peso(1_000) },
      ],
    })
    if (!result.ok) return assert.fail(result.error)
    const byLender = Object.fromEntries(result.value.fundings.map((f) => [f.lenderId, f]))
    assert.equal(byLender.maria.earnings, peso(200))
    assert.equal(byLender.jun.earnings, peso(100))
    const earned = result.value.fundings.reduce((sum, f) => sum + f.earnings + f.adminCut, 0)
    assert.equal(earned, peso(500))
  })

  test("the admin's own money takes its share of the remainder as earnings", () => {
    const result = loanTerms({
      ...threeDays,
      interest: fixed(500, 300),
      funders: [
        { lenderId: 'admin', isSelf: true, principal: peso(1_000) },
        { lenderId: 'john', isSelf: false, principal: peso(2_000) },
      ],
    })
    if (!result.ok) return assert.fail(result.error)
    const byLender = Object.fromEntries(result.value.fundings.map((f) => [f.lenderId, f]))
    // John is the only lender, so the whole ₱300 is his. The ₱200 left spreads
    // across both rows by principal: ₱66.67 onto the admin's third of the
    // capital as earnings, ₱133.33 onto John's two thirds as the cut.
    assert.equal(byLender.john.earnings, peso(300))
    assert.equal(byLender.admin.adminCut, 0)
    assert.equal(byLender.admin.earnings + byLender.john.adminCut, peso(200))
    assert.equal(
      result.value.fundings.reduce((sum, f) => sum + f.earnings + f.adminCut, 0),
      peso(500),
    )
  })

  test('an admin-only loan keeps the whole interest, with no share to hand out', () => {
    const result = loanTerms({
      ...threeDays,
      interest: fixed(500, 0),
      funders: [{ lenderId: 'admin', isSelf: true, principal: peso(3_000) }],
    })
    if (!result.ok) return assert.fail(result.error)
    assert.equal(result.value.fundings[0].earnings, peso(500))
    assert.equal(result.value.fundings[0].adminCut, 0)
  })

  test('a share larger than the interest is refused', () => {
    const result = loanTerms({
      ...threeDays,
      interest: fixed(500, 600),
      funders: [{ lenderId: 'john', isSelf: false, principal: peso(3_000) }],
    })
    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.error, /more than the whole interest/)
  })

  test('a share set aside when every peso is the Admin pot is refused', () => {
    const result = loanTerms({
      ...threeDays,
      interest: fixed(500, 300),
      funders: [{ lenderId: 'admin', isSelf: true, principal: peso(3_000) }],
    })
    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.error, /Admin pot/)
  })

  test('zero interest is refused', () => {
    const result = loanTerms({
      ...threeDays,
      interest: fixed(0, 0),
      funders: [{ lenderId: 'john', isSelf: false, principal: peso(3_000) }],
    })
    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.error, /greater than zero/)
  })

  test('same day is still refused, but a single day is allowed', () => {
    const sameDay = loanTerms({
      ...threeDays,
      dueOn: threeDays.startOn,
      interest: fixed(500, 300),
      funders: [{ lenderId: 'john', isSelf: false, principal: peso(3_000) }],
    })
    assert.equal(sameDay.ok, false)
    if (!sameDay.ok) assert.match(sameDay.error, /at least one day/)

    const oneDay = loanTerms({
      ...threeDays,
      dueOn: on(2026, 2, 2),
      interest: fixed(500, 300),
      funders: [{ lenderId: 'john', isSelf: false, principal: peso(3_000) }],
    })
    assert.equal(oneDay.ok, true)
    if (oneDay.ok) assert.equal(oneDay.value.termDays, 1)
  })

  test('the funding must still add up to the capital', () => {
    const result = loanTerms({
      ...threeDays,
      interest: fixed(500, 300),
      funders: [{ lenderId: 'john', isSelf: false, principal: peso(2_500) }],
    })
    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.error, /₱500\.00 short/)
  })
})

describe('reading a rate the admin typed', () => {
  test('"7" is 700 basis points', () => {
    const result = parseRate('7')
    assert.equal(result.ok, true)
    if (result.ok) assert.equal(result.value, 700)
  })

  test('a half percent survives', () => {
    const result = parseRate('7.5')
    assert.equal(result.ok, true)
    if (result.ok) assert.equal(result.value, 750)
  })

  test('a typed percent sign is ignored, not refused', () => {
    const result = parseRate('2%')
    assert.equal(result.ok, true)
    if (result.ok) assert.equal(result.value, 200)
  })

  test('nonsense and blanks are refused', () => {
    for (const input of ['', 'seven', '-2']) {
      assert.equal(parseRate(input).ok, false, `expected "${input}" to be refused`)
    }
  })
})

describe('collecting the interest weekly', () => {
  const funders = [{ lenderId: 'john', isSelf: false, principal: peso(30_000) }]

  test('the figures are identical to collecting it all at the end', () => {
    const atEnd = loanTerms({ ...base, funders })
    const weekly = loanTerms({ ...base, collection: 'WEEKLY', funders })
    if (!atEnd.ok || !weekly.ok) return assert.fail('both should be accepted')

    // The whole point: WHEN the money is collected, never how much it is.
    assert.equal(weekly.value.interest, atEnd.value.interest)
    assert.equal(weekly.value.total, atEnd.value.total)
    assert.equal(weekly.value.termDays, atEnd.value.termDays)
    assert.deepEqual(weekly.value.fundings, atEnd.value.fundings)
  })

  test('a new weekly loan owes its first week one week after it started', () => {
    const result = loanTerms({ ...base, collection: 'WEEKLY', funders })
    if (!result.ok) return assert.fail(result.error)
    assert.equal(result.value.nextDueOn.getTime(), on(2026, 2, 8).getTime())
  })

  test('a loan collected at the end owes on its due date', () => {
    const result = loanTerms({ ...base, funders })
    if (!result.ok) return assert.fail(result.error)
    assert.equal(result.value.nextDueOn.getTime(), base.dueOn.getTime())
  })

  test('one week is refused: that is just a loan', () => {
    const result = loanTerms({
      ...base,
      dueOn: on(2026, 2, 8), // 7 days
      collection: 'WEEKLY',
      funders,
    })
    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.error, /at least two weeks/)
  })

  test('two weeks is the shortest that is accepted', () => {
    const result = loanTerms({ ...base, dueOn: on(2026, 2, 15), collection: 'WEEKLY', funders })
    assert.equal(result.ok, true)
  })

  test('a fixed amount of interest cannot be collected weekly', () => {
    const result = loanTerms({
      ...base,
      interest: fixed(500, 300),
      collection: 'WEEKLY',
      funders,
    })
    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.error, /fixed amount of interest cannot be collected weekly/)
  })
})
