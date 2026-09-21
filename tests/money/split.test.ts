import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { centavos, type Centavos } from '../../src/lib/money/centavos.ts'
import { splitLoan, adminTotalEarnings, type LoanTerms, type Split } from '../../src/lib/money/split.ts'

const peso = (n: number) => centavos(n * 100)

function mustSplit(terms: LoanTerms): Split {
  const result = splitLoan(terms)
  assert.equal(result.ok, true, `expected a valid split, got ${JSON.stringify(result)}`)
  if (!result.ok) throw new Error('unreachable')
  return result.value
}

const earningsOf = (split: Split, lenderId: string): Centavos => {
  const share = split.lenders.find((l) => l.lenderId === lenderId)
  assert.ok(share, `no share for ${lenderId}`)
  return share.earnings
}

describe('one lender funds the whole loan', () => {
  // Angel borrows ₱30,000 for 4 weeks at 7%. John Ross funds it at 5%; admin keeps 2%.
  const split = mustSplit({
    capital: peso(30_000),
    borrowerRateBps: 700,
    weeks: 4,
    fundings: [{ lenderId: 'john-ross', principal: peso(30_000), lenderRateBps: 500, adminCutBps: 200 }],
  })

  test('Angel is charged ₱8,400 interest', () => {
    assert.equal(split.totalInterest, peso(8_400))
  })
  test('Angel repays ₱38,400', () => {
    assert.equal(split.borrowerTotal, peso(38_400))
  })
  test('John Ross earns ₱6,000', () => {
    assert.equal(earningsOf(split, 'john-ross'), peso(6_000))
  })
  test('the admin earns ₱2,400', () => {
    assert.equal(split.adminEarnings, peso(2_400))
  })
})

describe('two lenders split the funding', () => {
  // Maria ₱20,000 + Jun ₱10,000. Each earns 5% on their own money.
  const split = mustSplit({
    capital: peso(30_000),
    borrowerRateBps: 700,
    weeks: 4,
    fundings: [
      { lenderId: 'maria', principal: peso(20_000), lenderRateBps: 500, adminCutBps: 200 },
      { lenderId: 'jun', principal: peso(10_000), lenderRateBps: 500, adminCutBps: 200 },
    ],
  })

  test('Maria earns ₱4,000 on her ₱20,000', () => {
    assert.equal(earningsOf(split, 'maria'), peso(4_000))
  })
  test('Jun earns ₱2,000 on his ₱10,000', () => {
    assert.equal(earningsOf(split, 'jun'), peso(2_000))
  })
  test('the admin still earns ₱2,400 — the cut does not change', () => {
    assert.equal(split.adminEarnings, peso(2_400))
  })
})

describe("mixed funding — the admin's own money alongside a lender's", () => {
  // Admin puts in ₱10,000 at the full 7%; John Ross ₱20,000 at 5% with a 2% cut.
  const split = mustSplit({
    capital: peso(30_000),
    borrowerRateBps: 700,
    weeks: 4,
    fundings: [
      { lenderId: 'admin', principal: peso(10_000), lenderRateBps: 700, adminCutBps: 0 },
      { lenderId: 'john-ross', principal: peso(20_000), lenderRateBps: 500, adminCutBps: 200 },
    ],
  })

  test("the admin's own ₱10,000 earns the full 7% — ₱2,800", () => {
    assert.equal(earningsOf(split, 'admin'), peso(2_800))
  })
  test("the admin's cut on John Ross's ₱20,000 is ₱1,600", () => {
    assert.equal(split.adminEarnings, peso(1_600))
  })
  test('John Ross earns ₱4,000', () => {
    assert.equal(earningsOf(split, 'john-ross'), peso(4_000))
  })
  test('the admin takes home ₱4,400 in total', () => {
    assert.equal(adminTotalEarnings(split, 'admin'), peso(4_400))
  })
  test('Angel is still charged exactly ₱8,400', () => {
    assert.equal(split.totalInterest, peso(8_400))
  })
})

describe('THE INVARIANT — the shares always sum to the interest charged', () => {
  // The single most valuable test here. Every case below must reconcile to the
  // centavo, including the ones that do not divide evenly.
  const cases: [string, LoanTerms][] = [
    [
      'awkward capital, three lenders',
      {
        capital: centavos(1_000_001),
        borrowerRateBps: 700,
        weeks: 3,
        fundings: [
          { lenderId: 'a', principal: centavos(333_333), lenderRateBps: 500, adminCutBps: 200 },
          { lenderId: 'b', principal: centavos(333_334), lenderRateBps: 500, adminCutBps: 200 },
          { lenderId: 'c', principal: centavos(333_334), lenderRateBps: 500, adminCutBps: 200 },
        ],
      },
    ],
    [
      'a single centavo of capital',
      {
        capital: centavos(1),
        borrowerRateBps: 700,
        weeks: 1,
        fundings: [{ lenderId: 'a', principal: centavos(1), lenderRateBps: 500, adminCutBps: 200 }],
      },
    ],
    [
      'rate that never divides cleanly',
      {
        capital: centavos(7),
        borrowerRateBps: 333,
        weeks: 7,
        fundings: [
          { lenderId: 'a', principal: centavos(3), lenderRateBps: 111, adminCutBps: 222 },
          { lenderId: 'b', principal: centavos(4), lenderRateBps: 111, adminCutBps: 222 },
        ],
      },
    ],
    [
      'five lenders, prime principals',
      {
        capital: centavos(1_111_111),
        borrowerRateBps: 700,
        weeks: 13,
        fundings: [
          { lenderId: 'a', principal: centavos(222_221), lenderRateBps: 500, adminCutBps: 200 },
          { lenderId: 'b', principal: centavos(222_222), lenderRateBps: 500, adminCutBps: 200 },
          { lenderId: 'c', principal: centavos(222_223), lenderRateBps: 500, adminCutBps: 200 },
          { lenderId: 'd', principal: centavos(222_222), lenderRateBps: 500, adminCutBps: 200 },
          { lenderId: 'e', principal: centavos(222_223), lenderRateBps: 500, adminCutBps: 200 },
        ],
      },
    ],
    [
      'admin takes no cut at all',
      {
        capital: centavos(999_983),
        borrowerRateBps: 500,
        weeks: 11,
        fundings: [{ lenderId: 'a', principal: centavos(999_983), lenderRateBps: 500, adminCutBps: 0 }],
      },
    ],
  ]

  for (const [name, terms] of cases) {
    test(`${name}: shares sum to the interest, to the centavo`, () => {
      const split = mustSplit(terms)
      const lenderTotal = split.lenders.reduce((sum, l) => sum + l.earnings, 0)
      assert.equal(
        lenderTotal + split.adminEarnings,
        split.totalInterest,
        'centavos went missing or were invented',
      )
    })

    test(`${name}: no share is negative`, () => {
      const split = mustSplit(terms)
      for (const l of split.lenders) assert.ok(l.earnings >= 0, `${l.lenderId} earned ${l.earnings}`)
      assert.ok(split.adminEarnings >= 0)
    })
  }

  test('exhaustive sweep: every capital from 1 to 2,000 centavos reconciles', () => {
    for (let capital = 1; capital <= 2_000; capital++) {
      const half = Math.floor(capital / 2)
      const fundings =
        half > 0
          ? [
              { lenderId: 'a', principal: centavos(half), lenderRateBps: 500, adminCutBps: 200 },
              { lenderId: 'b', principal: centavos(capital - half), lenderRateBps: 500, adminCutBps: 200 },
            ]
          : [{ lenderId: 'a', principal: centavos(capital), lenderRateBps: 500, adminCutBps: 200 }]

      const split = mustSplit({ capital: centavos(capital), borrowerRateBps: 700, weeks: 3, fundings })
      const total = split.lenders.reduce((sum, l) => sum + l.earnings, 0) + split.adminEarnings
      assert.equal(total, split.totalInterest, `capital ${capital} did not reconcile`)
    }
  })

  test('the same loan always splits the same way', () => {
    const terms = cases[0][1]
    const first = JSON.stringify(mustSplit(terms))
    for (let i = 0; i < 20; i++) assert.equal(JSON.stringify(mustSplit(terms)), first)
  })
})

describe('funding that does not add up is refused', () => {
  const base = { capital: peso(30_000), borrowerRateBps: 700, weeks: 4 }

  test('under-funded', () => {
    const result = splitLoan({
      ...base,
      fundings: [{ lenderId: 'a', principal: peso(20_000), lenderRateBps: 500, adminCutBps: 200 }],
    })
    assert.equal(result.ok, false)
    if (!result.ok && result.error.kind === 'fundings-do-not-match-capital') {
      assert.equal(result.error.difference, peso(-10_000))
    } else assert.fail('expected fundings-do-not-match-capital')
  })

  test('over-funded', () => {
    const result = splitLoan({
      ...base,
      fundings: [{ lenderId: 'a', principal: peso(40_000), lenderRateBps: 500, adminCutBps: 200 }],
    })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.error.kind, 'fundings-do-not-match-capital')
  })

  test('off by a single centavo', () => {
    const result = splitLoan({
      ...base,
      fundings: [{ lenderId: 'a', principal: centavos(2_999_999), lenderRateBps: 500, adminCutBps: 200 }],
    })
    assert.equal(result.ok, false)
  })

  test('rates that do not add up to the borrower rate', () => {
    const result = splitLoan({
      ...base,
      fundings: [{ lenderId: 'a', principal: peso(30_000), lenderRateBps: 500, adminCutBps: 100 }],
    })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.error.kind, 'rates-do-not-match-borrower-rate')
  })

  test('no fundings at all', () => {
    const result = splitLoan({ ...base, fundings: [] })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.error.kind, 'no-fundings')
  })

  test('the same lender listed twice', () => {
    const result = splitLoan({
      ...base,
      fundings: [
        { lenderId: 'a', principal: peso(15_000), lenderRateBps: 500, adminCutBps: 200 },
        { lenderId: 'a', principal: peso(15_000), lenderRateBps: 500, adminCutBps: 200 },
      ],
    })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.error.kind, 'duplicate-lender')
  })

  test('a lender contributing nothing', () => {
    const result = splitLoan({
      ...base,
      fundings: [
        { lenderId: 'a', principal: peso(30_000), lenderRateBps: 500, adminCutBps: 200 },
        { lenderId: 'b', principal: centavos(0), lenderRateBps: 500, adminCutBps: 200 },
      ],
    })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.error.kind, 'non-positive-principal')
  })
})
