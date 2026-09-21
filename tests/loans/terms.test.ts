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
  borrowerRateBps: 700,
  adminCutBps: 200,
}

describe("Angel's loan — the worked example, end to end", () => {
  const result = loanTerms({
    ...base,
    funders: [{ lenderId: 'john', isSelf: false, principal: peso(30_000) }],
  })

  test('the dates come out at 4 weeks', () => {
    assert.equal(result.ok, true)
    if (result.ok) assert.equal(result.value.weeks, 4)
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
      if (result.ok) assert.equal(result.value.weeks, weeks)
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
    const result = loanTerms({ ...base, borrowerRateBps: 200, adminCutBps: 700, funders })
    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.error, /cannot be larger/)
  })

  test('a zero cut is fine — the lender simply takes the whole rate', () => {
    const result = loanTerms({ ...base, adminCutBps: 0, funders })
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.equal(result.value.fundings[0].lenderRateBps, 700)
      assert.equal(result.value.split.adminEarnings, 0)
    }
  })

  test('the cut is per loan, not global — 3% works as readily as 2%', () => {
    const result = loanTerms({ ...base, adminCutBps: 300, funders })
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.equal(result.value.fundings[0].earnings, peso(4_800)) // 30,000 x 4% x 4
      assert.equal(result.value.split.adminEarnings, peso(3_600)) // 30,000 x 3% x 4
    }
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
