// Throwaway stress test for src/lib/money/weekly.ts, written by the independent tester,
// run standalone with plain node (no npm test framework, no database).
// Verifies, against awkward (non-dividing) principals:
//   (1) every week's per-funder shares sum to that week's total interest
//   (2) every funder's weeks sum back to their stored total (earnings + adminCut)
//   (3) realisedThrough agrees with summing weeklySlices for EVERY prefix
//   (4) nextUnpaidWeek / consecutivePaidWeeks / releasedOnFunding / collectedInstalments
//       behave sanely on gapped payment sets
// This file is scratch work for verification only — not part of the app or its test suite.

import { centavos, type Centavos } from '../../../src/lib/money/centavos.ts'
import { splitLoan, type Funding } from '../../../src/lib/money/split.ts'
import {
  weeklySlices,
  weeklySchedule,
  realisedThrough,
  weeklyDueDates,
  nextUnpaidWeek,
  consecutivePaidWeeks,
  releasedOnFunding,
  collectedInstalments,
  type WeeklyFunder,
} from '../../../src/lib/money/weekly.ts'

let failures = 0
let checks = 0

function check(name: string, cond: boolean, detail?: unknown) {
  checks += 1
  if (!cond) {
    failures += 1
    console.error(`FAIL: ${name}`, detail ?? '')
  }
}

// ---------- 1 & 2: weeklySlices sum invariant, standalone ----------
const sliceCases: Array<[number, number]> = [
  [1, 5],       // one centavo over 5 weeks
  [7, 3],
  [100, 3],
  [999_999_999, 7],
  [1, 1],
  [3, 1],
  [10, 10],
  [10, 11], // more weeks than centavos
  [123_456_789, 23],
  [2, 3],
]
for (const [total, weeks] of sliceCases) {
  const slices = weeklySlices(centavos(total), weeks)
  const sum = slices.reduce((a, b) => a + b, 0)
  check(`weeklySlices(${total},${weeks}) sums to total`, sum === total, { slices, sum })
  check(`weeklySlices(${total},${weeks}) has ${weeks} entries`, slices.length === weeks)
  const base = slices[0]
  for (let i = 0; i < slices.length - 1; i++) {
    check(`weeklySlices(${total},${weeks}) slice ${i} equals base`, slices[i] === base)
  }
}

try {
  weeklySlices(centavos(100), 0)
  check('weeklySlices refuses zero weeks', false)
} catch {
  check('weeklySlices refuses zero weeks', true)
}
try {
  weeklySlices(centavos(-1), 3)
  check('weeklySlices refuses negative amount', false)
} catch {
  check('weeklySlices refuses negative amount', true)
}

// ---------- Build real splitLoan cases with awkward, non-dividing principals ----------
type Case = { name: string; capital: number; borrowerRateBps: number; weeks: number; fundings: Funding[] }

const cases: Case[] = [
  {
    name: 'single funder, prime capital, 7 weeks',
    capital: 1_000_037,
    borrowerRateBps: 700,
    weeks: 7,
    fundings: [{ lenderId: 'L1', principal: centavos(1_000_037), lenderRateBps: 500, adminCutBps: 200 }],
  },
  {
    name: 'two funders, uneven split, 23 weeks',
    capital: 6_000_001,
    borrowerRateBps: 700,
    weeks: 23,
    fundings: [
      { lenderId: 'ADMIN', principal: centavos(3_000_001), lenderRateBps: 700, adminCutBps: 0 },
      { lenderId: 'L2', principal: centavos(3_000_000), lenderRateBps: 500, adminCutBps: 200 },
    ],
  },
  {
    name: 'three funders, awkward thirds, 5 weeks',
    capital: 1_000_000,
    borrowerRateBps: 700,
    weeks: 5,
    fundings: [
      { lenderId: 'A', principal: centavos(333_334), lenderRateBps: 500, adminCutBps: 200 },
      { lenderId: 'B', principal: centavos(333_333), lenderRateBps: 500, adminCutBps: 200 },
      { lenderId: 'C', principal: centavos(333_333), lenderRateBps: 500, adminCutBps: 200 },
    ],
  },
  {
    name: 'tiny loan, MIN_WEEKLY_WEEKS=2',
    capital: 100,
    borrowerRateBps: 700,
    weeks: 2,
    fundings: [{ lenderId: 'L1', principal: centavos(100), lenderRateBps: 500, adminCutBps: 200 }],
  },
  {
    name: 'many weeks (52), single funder, non-dividing capital',
    capital: 987_653,
    borrowerRateBps: 700,
    weeks: 52,
    fundings: [{ lenderId: 'L1', principal: centavos(987_653), lenderRateBps: 500, adminCutBps: 200 }],
  },
]

for (const c of cases) {
  const result = splitLoan({
    capital: centavos(c.capital),
    borrowerRateBps: c.borrowerRateBps,
    weeks: c.weeks,
    fundings: c.fundings,
  })
  if (!result.ok) {
    check(`${c.name}: splitLoan succeeds`, false, result.error)
    continue
  }
  const split = result.value

  const weeklyFunders: WeeklyFunder[] = split.lenders.map((l) => ({
    lenderId: l.lenderId,
    earnings: l.earnings,
    adminCut: l.adminCut,
  }))

  const schedule = weeklySchedule(weeklyFunders, c.weeks)
  check(`${c.name}: schedule has ${c.weeks} weeks`, schedule.length === c.weeks)

  for (const week of schedule) {
    const sumShares = week.lenders.reduce((a, b) => a + b.earnings, 0) + week.adminCut
    check(`${c.name}: week ${week.week} shares sum to week interest`, sumShares === week.interest, {
      sumShares,
      weekInterest: week.interest,
    })
  }

  const totalAcrossWeeks = schedule.reduce((a, w) => a + w.interest, 0)
  check(`${c.name}: sum of all weeks equals split.totalInterest`, totalAcrossWeeks === split.totalInterest, {
    totalAcrossWeeks,
    totalInterest: split.totalInterest,
  })

  for (const funder of weeklyFunders) {
    const earningsAcrossWeeks = schedule.reduce(
      (a, w) => a + (w.lenders.find((l) => l.lenderId === funder.lenderId)?.earnings ?? 0),
      0,
    )
    check(`${c.name}: funder ${funder.lenderId} earnings sum to stored total`, earningsAcrossWeeks === funder.earnings, {
      earningsAcrossWeeks,
      stored: funder.earnings,
    })
  }
  const adminCutAcrossWeeks = schedule.reduce((a, w) => a + w.adminCut, 0)
  const storedAdminCutTotal = weeklyFunders.reduce((a, f) => a + f.adminCut, 0)
  check(`${c.name}: adminCut across weeks equals stored admin cut total`, adminCutAcrossWeeks === storedAdminCutTotal, {
    adminCutAcrossWeeks,
    storedAdminCutTotal,
  })

  // ---------- 3: realisedThrough vs summing weeklySlices, for EVERY prefix ----------
  for (const funder of weeklyFunders) {
    for (const total of [funder.earnings, funder.adminCut]) {
      if (total === 0) continue
      const slices = weeklySlices(total, c.weeks)
      let running = 0
      for (let paid = 0; paid <= c.weeks; paid++) {
        const viaRealised = realisedThrough(total, c.weeks, paid)
        check(
          `${c.name}: realisedThrough(${total},${c.weeks},${paid}) matches summed slices`,
          viaRealised === running,
          { viaRealised, running, paid },
        )
        if (paid < c.weeks) running += slices[paid]
      }
      check(`${c.name}: after all weeks, running total equals stored total`, running === total, {
        running,
        total,
      })
    }
  }
}

// ---------- 4: date/gap logic ----------
const start = new Date(2026, 0, 1, 12)
const weeks = 5
const dueDates = weeklyDueDates(start, weeks)
check('weeklyDueDates returns 5 dates', dueDates.length === 5)
check('weeklyDueDates dates are midday (hour=12)', dueDates.every((d) => d.getHours() === 12))
for (let i = 0; i < weeks; i++) {
  const expectedDaysFromStart = (i + 1) * 7
  const diffDays = Math.round((dueDates[i].getTime() - start.getTime()) / 86_400_000)
  check(`weeklyDueDates week ${i + 1} is ${expectedDaysFromStart} days out`, diffDays === expectedDaysFromStart)
}

const gapPaid = new Set([1, 3])
const nextUnpaid = nextUnpaidWeek(start, weeks, gapPaid)
check('nextUnpaidWeek with gap returns week 2 (earliest unpaid), not week 4', nextUnpaid?.week === 2, nextUnpaid)

const allPaid = new Set([1, 2, 3, 4, 5])
check('nextUnpaidWeek returns null when all paid', nextUnpaidWeek(start, weeks, allPaid) === null)

check('consecutivePaidWeeks errs downward on a gap (run=1, not size=2)', consecutivePaidWeeks(weeks, gapPaid) === 1)
check('consecutivePaidWeeks with weeks 1,2,3 paid returns 3', consecutivePaidWeeks(weeks, new Set([1, 2, 3])) === 3)
check('consecutivePaidWeeks with nothing paid returns 0', consecutivePaidWeeks(weeks, new Set()) === 0)
check('consecutivePaidWeeks with all paid returns weeks', consecutivePaidWeeks(weeks, allPaid) === weeks)

{
  const funding = { earnings: centavos(1000), adminCut: centavos(400) }
  const releasedGap = releasedOnFunding(funding, weeks, gapPaid)
  const expectedEarnings = realisedThrough(funding.earnings, weeks, 1)
  const expectedAdminCut = realisedThrough(funding.adminCut, weeks, 1)
  check(
    'releasedOnFunding uses consecutivePaidWeeks (run), matches realisedThrough(...,1)',
    releasedGap.earnings === expectedEarnings && releasedGap.adminCut === expectedAdminCut,
    releasedGap,
  )
}

{
  const c = cases[2]
  const result = splitLoan({ capital: centavos(c.capital), borrowerRateBps: c.borrowerRateBps, weeks: c.weeks, fundings: c.fundings })
  if (result.ok) {
    const weeklyFunders: WeeklyFunder[] = result.value.lenders.map((l) => ({ lenderId: l.lenderId, earnings: l.earnings, adminCut: l.adminCut }))
    const schedule = weeklySchedule(weeklyFunders, c.weeks)
    const paidOn1 = new Date(2026, 1, 10, 12)
    const paidOn3 = new Date(2026, 2, 3, 12)
    const instalments = collectedInstalments(weeklyFunders, c.weeks, [
      { week: 3, paidOn: paidOn3 },
      { week: 1, paidOn: paidOn1 },
    ])
    check('collectedInstalments returns sorted by week', instalments.map((i) => i.week).join(',') === '1,3')
    check('collectedInstalments week 1 matches schedule week 1 interest', instalments[0].interest === schedule[0].interest)
    check('collectedInstalments week 3 matches schedule week 3 interest', instalments[1].interest === schedule[2].interest)
    check('collectedInstalments week 1 carries its paidOn date', instalments[0].paidOn.getTime() === paidOn1.getTime())
    const withBogus = collectedInstalments(weeklyFunders, c.weeks, [{ week: 99, paidOn: new Date() }, { week: 1, paidOn: paidOn1 }])
    check('collectedInstalments filters out-of-range week numbers', withBogus.length === 1 && withBogus[0].week === 1, withBogus)
  } else {
    check('collectedInstalments setup: splitLoan succeeds', false, result.error)
  }
}

// ---------- Randomised prefix-sum fuzz for realisedThrough vs weeklySlices ----------
function mulberry32(seed: number) {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rand = mulberry32(42)
let fuzzCases = 0
for (let i = 0; i < 500; i++) {
  const total = Math.floor(rand() * 10_000_000)
  const fweeks = 1 + Math.floor(rand() * 60)
  const slices = weeklySlices(centavos(total), fweeks)
  let running = 0
  for (let paid = 0; paid <= fweeks; paid++) {
    const viaRealised = realisedThrough(centavos(total), fweeks, paid)
    if (viaRealised !== running) {
      failures += 1
      console.error(`FUZZ FAIL: total=${total} weeks=${fweeks} paid=${paid} viaRealised=${viaRealised} running=${running}`)
    }
    checks += 1
    if (paid < fweeks) running += slices[paid]
  }
  if (running !== total) {
    failures += 1
    console.error(`FUZZ FAIL: total=${total} weeks=${fweeks} final running=${running} != total`)
  }
  checks += 1
  fuzzCases += 1
}

console.log(`\n${checks} checks run across ${cases.length} split cases + ${sliceCases.length} slice cases + ${fuzzCases} fuzz cases.`)
if (failures > 0) {
  console.error(`\n${failures} FAILURES`)
  process.exit(1)
} else {
  console.log('ALL PASS')
  process.exit(0)
}
