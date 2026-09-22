import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { centavos, type Centavos } from '../../src/lib/money/centavos.ts'
import {
  splitFixed,
  splitLoan,
  adminTakeOnLoan,
  adminTotalEarnings,
  type FixedTerms,
  type LoanTerms,
  type Split,
} from '../../src/lib/money/split.ts'

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

describe('a fixed amount of interest reconciles the same way', () => {
  function mustSplitFixed(terms: FixedTerms): Split {
    const result = splitFixed(terms)
    assert.equal(result.ok, true, `expected a valid split, got ${JSON.stringify(result)}`)
    if (!result.ok) throw new Error('unreachable')
    return result.value
  }

  test('nothing is derived: the total is exactly what was typed', () => {
    const split = mustSplitFixed({
      capital: peso(3_000),
      interest: peso(500),
      lenderInterest: peso(300),
      fundings: [{ lenderId: 'john', principal: peso(3_000), isSelf: false }],
    })
    assert.equal(split.totalInterest, peso(500))
    assert.equal(split.borrowerTotal, peso(3_500))
    assert.equal(earningsOf(split, 'john'), peso(300))
    assert.equal(split.adminEarnings, peso(200))
  })

  // THE REASON THIS FILE EXISTS, said again for the typed basis: an amount that
  // does not divide evenly must still come out whole, with nothing dropped and
  // nothing invented. ₱500 across three funders divides into recurring thirds.
  test('exhaustive sweep: every interest from 1 to 2,000 centavos reconciles', () => {
    for (let interest = 1; interest <= 2_000; interest++) {
      const lenderShare = Math.floor(interest / 2)
      const split = mustSplitFixed({
        capital: centavos(3_000_00),
        interest: centavos(interest),
        lenderInterest: centavos(lenderShare),
        fundings: [
          { lenderId: 'a', principal: centavos(1_000_00), isSelf: false },
          { lenderId: 'b', principal: centavos(1_000_01), isSelf: false },
          { lenderId: 'admin', principal: centavos(999_99), isSelf: true },
        ],
      })

      const handedOut = split.lenders.reduce((sum, l) => sum + l.earnings + l.adminCut, 0)
      assert.equal(handedOut, centavos(interest), `interest ${interest} did not reconcile`)
      for (const l of split.lenders) {
        assert.ok(l.earnings >= 0 && l.adminCut >= 0, `${l.lenderId} went negative`)
      }
    }
  })

  test('the admin pot never charges itself a cut', () => {
    const split = mustSplitFixed({
      capital: peso(3_000),
      interest: peso(500),
      lenderInterest: peso(300),
      fundings: [
        { lenderId: 'admin', principal: peso(1_000), isSelf: true },
        { lenderId: 'john', principal: peso(2_000), isSelf: false },
      ],
    })
    const admin = split.lenders.find((l) => l.lenderId === 'admin')
    assert.equal(admin?.adminCut, 0)
    // Their share of the ₱200 remainder arrives as earnings on their own row,
    // which is where adminTakeOnLoan looks for it.
    assert.equal(
      adminTakeOnLoan(
        split.lenders.map((l) => ({
          adminCut: l.adminCut,
          earnings: l.earnings,
          isSelf: l.lenderId === 'admin',
        })),
      ),
      peso(200),
    )
  })

  test('the same loan always splits the same way', () => {
    const terms: FixedTerms = {
      capital: peso(3_000),
      interest: peso(500),
      lenderInterest: peso(333),
      fundings: [
        { lenderId: 'a', principal: peso(1_000), isSelf: false },
        { lenderId: 'b', principal: peso(1_000), isSelf: false },
        { lenderId: 'c', principal: peso(1_000), isSelf: false },
      ],
    }
    const first = JSON.stringify(mustSplitFixed(terms))
    for (let i = 0; i < 20; i++) assert.equal(JSON.stringify(mustSplitFixed(terms)), first)
  })

  test('the figures that cannot be are refused', () => {
    const base = {
      capital: peso(3_000),
      fundings: [{ lenderId: 'john', principal: peso(3_000), isSelf: false }],
    }
    assert.equal(splitFixed({ ...base, interest: centavos(0), lenderInterest: centavos(0) }).ok, false)
    assert.equal(splitFixed({ ...base, interest: peso(500), lenderInterest: peso(501) }).ok, false)
    assert.equal(
      splitFixed({
        capital: peso(3_000),
        interest: peso(500),
        lenderInterest: peso(1),
        fundings: [{ lenderId: 'admin', principal: peso(3_000), isSelf: true }],
      }).ok,
      false,
    )
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

describe("the admin's cut, broken down to the rows it came from", () => {
  const peso4 = (n: number) => centavos(n * 100)

  test("the spec's split example: ₱2,400 over two lenders' shares", () => {
    const result = splitLoan({
      capital: peso4(30_000),
      borrowerRateBps: 700,
      weeks: 4,
      fundings: [
        { lenderId: 'maria', principal: peso4(20_000), lenderRateBps: 500, adminCutBps: 200 },
        { lenderId: 'jun', principal: peso4(10_000), lenderRateBps: 500, adminCutBps: 200 },
      ],
    })
    assert.equal(result.ok, true)
    if (!result.ok) return

    const cuts = Object.fromEntries(result.value.lenders.map((l) => [l.lenderId, l.adminCut]))
    assert.equal(cuts.maria, peso4(1_600))
    assert.equal(cuts.jun, peso4(800))
    assert.equal(cuts.maria + cuts.jun, result.value.adminEarnings)
  })

  test("the admin's own capital carries no cut — they charge themselves nothing", () => {
    const result = splitLoan({
      capital: peso4(30_000),
      borrowerRateBps: 700,
      weeks: 4,
      fundings: [
        { lenderId: 'admin', principal: peso4(10_000), lenderRateBps: 700, adminCutBps: 0 },
        { lenderId: 'john', principal: peso4(20_000), lenderRateBps: 500, adminCutBps: 200 },
      ],
    })
    assert.equal(result.ok, true)
    if (!result.ok) return

    const byLender = Object.fromEntries(result.value.lenders.map((l) => [l.lenderId, l]))
    assert.equal(byLender.admin.adminCut, 0)
    assert.equal(byLender.john.adminCut, peso4(1_600))
    assert.equal(result.value.adminEarnings, peso4(1_600))
  })

  test('a loan funded entirely by the admin leaves no cut anywhere', () => {
    const result = splitLoan({
      capital: peso4(25_000),
      borrowerRateBps: 700,
      weeks: 4,
      fundings: [{ lenderId: 'admin', principal: peso4(25_000), lenderRateBps: 700, adminCutBps: 0 }],
    })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.value.adminEarnings, 0)
    assert.equal(result.value.lenders[0].adminCut, 0)
  })

  test('the row cuts always sum to exactly the admin total — awkward numbers included', () => {
    // Three-way splits of prime-ish amounts are where independent rounding of
    // each row drifts away from the total. Nothing here is allowed to drift.
    for (let capital = 1; capital <= 2_000; capital += 1) {
      const a = Math.max(1, Math.floor(capital / 3))
      const b = Math.max(1, Math.floor(capital / 3))
      const c = capital - a - b
      if (c <= 0) continue

      const result = splitLoan({
        capital: centavos(capital),
        borrowerRateBps: 700,
        weeks: 3,
        fundings: [
          { lenderId: 'a', principal: centavos(a), lenderRateBps: 500, adminCutBps: 200 },
          { lenderId: 'b', principal: centavos(b), lenderRateBps: 500, adminCutBps: 200 },
          { lenderId: 'c', principal: centavos(c), lenderRateBps: 700, adminCutBps: 0 },
        ],
      })
      assert.equal(result.ok, true, `capital ${capital} should split`)
      if (!result.ok) continue

      const summed = result.value.lenders.reduce((sum, l) => sum + l.adminCut, 0)
      assert.equal(summed, result.value.adminEarnings, `capital ${capital}: row cuts must sum to the admin total`)

      const noCut = result.value.lenders.find((l) => l.lenderId === 'c')
      assert.equal(noCut?.adminCut, 0, `capital ${capital}: the admin's own row must carry no cut`)
    }
  })

  test('everything still reconciles: lender earnings + admin total = the interest charged', () => {
    for (let capital = 1; capital <= 500; capital += 1) {
      const result = splitLoan({
        capital: centavos(capital),
        borrowerRateBps: 700,
        weeks: 5,
        fundings: [
          { lenderId: 'a', principal: centavos(Math.ceil(capital / 2)), lenderRateBps: 500, adminCutBps: 200 },
          { lenderId: 'b', principal: centavos(Math.floor(capital / 2)), lenderRateBps: 500, adminCutBps: 200 },
        ].filter((f) => f.principal > 0),
      })
      if (!result.ok) continue
      const earned = result.value.lenders.reduce((sum, l) => sum + l.earnings, 0)
      assert.equal(earned + result.value.adminEarnings, result.value.totalInterest, `capital ${capital}`)
    }
  })
})

describe('adminTakeOnLoan — the same answer, read back from stored rows', () => {
  // The figure the loan screen shows and the figure a report prints come from
  // this one function, so they cannot drift apart.
  const rows = (
    entries: [adminCut: number, earnings: number, isSelf: boolean][],
  ) =>
    entries.map(([adminCut, earnings, isSelf]) => ({
      adminCut: peso(adminCut),
      earnings: peso(earnings),
      isSelf,
    }))

  test("adds the admin's cut across every funder", () => {
    assert.equal(adminTakeOnLoan(rows([[600, 1500, false], [400, 1000, false]])), peso(1000))
  })

  // On a row the admin funded themselves the cut is zero — they do not charge
  // themselves — so their earnings as a funder are what they take.
  test("adds what the admin's own capital earned", () => {
    assert.equal(adminTakeOnLoan(rows([[0, 2100, true]])), peso(2100))
  })

  test('mixed funding is the sum of both, counted once', () => {
    assert.equal(
      adminTakeOnLoan(rows([[600, 1500, false], [0, 700, true]])),
      peso(600 + 700),
    )
  })

  test('a loan nobody earned anything on is zero, not NaN', () => {
    assert.equal(adminTakeOnLoan([]), 0)
    assert.equal(adminTakeOnLoan(rows([[0, 0, false]])), 0)
  })

  // The invariant that matters: what the admin takes plus what the other
  // funders keep IS the interest the borrower was charged. No centavo is
  // invented and none goes missing.
  test('it reconciles with a real split, to the centavo', () => {
    const split = mustSplit({
      capital: peso(30_000),
      borrowerRateBps: 700,
      weeks: 4,
      fundings: [
        { lenderId: 'john', principal: peso(20_000), lenderRateBps: 500, adminCutBps: 200 },
        { lenderId: 'admin', principal: peso(10_000), lenderRateBps: 700, adminCutBps: 0 },
      ],
    })

    const stored = split.lenders.map((share) => ({
      adminCut: share.adminCut,
      earnings: share.earnings,
      isSelf: share.lenderId === 'admin',
    }))

    assert.equal(adminTakeOnLoan(stored), adminTotalEarnings(split, 'admin'))

    const others = split.lenders
      .filter((share) => share.lenderId !== 'admin')
      .reduce((total, share) => total + share.earnings, 0)
    assert.equal(adminTakeOnLoan(stored) + others, split.totalInterest)
  })
})
