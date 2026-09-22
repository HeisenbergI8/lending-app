/**
 * Bulk rows for LOOKING AT PAGINATION, and nothing else.
 *
 * Unlike demo.ts this writes into a REAL account, so two rules shape it:
 *
 *   1. IT NEVER DELETES ANYTHING. demo.ts wipes its user and rebuilds; this one
 *      only ever inserts. Nothing already in the account is touched.
 *   2. EVERY ROW IS MARKED. Every person it creates has the first name ZZSEED,
 *      so the cleanup script can find them exactly and take nothing else with
 *      them. The marker is deliberately not "ZZTEST" — that one is already in
 *      use in this account by hand, and a cleanup must not eat it.
 *
 * Money still goes through splitLoan, exactly as demo.ts does, so the seeded
 * loans reconcile like real ones and the totals on screen stay checkable.
 *
 *   node --env-file=.env prisma/seed/pagination-demo.ts <username>
 *
 * To remove every row it wrote:
 *
 *   node --env-file=.env prisma/seed/pagination-clean.ts <username>
 */

import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, LenderTransactionType, LoanStatus, BorrowerLabel } from '@prisma/client'

import { centavos } from '../../src/lib/money/centavos.ts'
import { DAYS_PER_WEEK } from '../../src/lib/money/weeks.ts'
import { splitLoan } from '../../src/lib/money/split.ts'
import { calendarDate, dueDateAfterWeeks } from '../../src/lib/money/weeks.ts'

/** The marker. Everything this script creates carries it as a first name. */
export const MARK = 'ZZSEED'

const peso = (n: number) => centavos(Math.round(n * 100))

function daysAgo(days: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return calendarDate(d)
}

/**
 * A fixed pseudo-random sequence.
 *
 * Seeded rather than Math.random so re-running produces the same spread of
 * amounts and dates — a list that reshuffles every run is one you cannot
 * compare against what you saw a minute ago.
 */
function rng(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL
if (!url) throw new Error('Neither DIRECT_URL nor DATABASE_URL is set. See .env.example.')

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })

const BORROWER_RATE_BPS = 700
const LENDER_RATE_BPS = 500
const ADMIN_CUT_BPS = 200

// Enough to push every paged list past its 20-row page, and to push the two
// biggest FILTERS past it too — the Active and Paid chips each need their own
// second page or the pager under them never appears.
const LIVE_BORROWERS = 45
const ACTIVE_LOANS = 42
const OVERDUE_LOANS = 13
const PAID_LOANS = 25
const BIN_LOANS = 25
const BIN_BORROWERS = 25
const BIN_LENDERS = 12
const BIN_TRANSACTIONS = 25

async function main() {
  const username = process.argv[2]
  if (!username) throw new Error('Pass the username to seed: node --env-file=.env prisma/seed/pagination-demo.ts <username>')

  const user = await prisma.user.findUnique({ where: { username }, select: { id: true, username: true } })
  if (!user) throw new Error(`No user called "${username}".`)
  const userId = user.id

  const already = await prisma.borrower.count({ where: { userId, firstName: MARK } })
  if (already > 0) {
    throw new Error(
      `This account already has ${already} ${MARK} borrowers. Run pagination-clean.ts first, so the two runs cannot stack up.`,
    )
  }

  console.log(`Seeding pagination rows into "${user.username}". Nothing existing is touched.`)

  // ── A lender of its own ───────────────────────────────────────────────────
  // The seeded loans are funded from here rather than from a real lender, so
  // nobody's actual floating-funds figure moves. The admin's cut still changes
  // while these loans exist — that is what a 2% cut means — and goes back when
  // they are cleaned up.
  const lender = await prisma.lender.create({
    data: { userId, firstName: MARK, lastName: 'Capital', isSelf: false },
  })

  await prisma.lenderTransaction.create({
    data: {
      userId,
      lenderId: lender.id,
      type: LenderTransactionType.DEPOSIT,
      amountCentavos: peso(3_000_000),
      occurredOn: daysAgo(400),
      note: 'Seeded capital for pagination testing',
    },
  })

  // ── Borrowers ─────────────────────────────────────────────────────────────
  const labels = [BorrowerLabel.GOOD, BorrowerLabel.OKAY, BorrowerLabel.BAD, null]
  await prisma.borrower.createMany({
    data: Array.from({ length: LIVE_BORROWERS }, (_, i) => ({
      userId,
      firstName: MARK,
      lastName: `Borrower ${String(i + 1).padStart(2, '0')}`,
      manualLabel: labels[i % labels.length],
    })),
  })

  const borrowers = await prisma.borrower.findMany({
    where: { userId, firstName: MARK },
    select: { id: true },
    orderBy: { lastName: 'asc' },
  })

  // ── Loans ─────────────────────────────────────────────────────────────────
  type Plan = { capital: number; weeks: number; startedDaysAgo: number; status: LoanStatus; deleted: boolean }

  const random = rng(20260922)
  const plans: Plan[] = []

  // Active: started recently, due comfortably ahead.
  for (let i = 0; i < ACTIVE_LOANS; i += 1) {
    const weeks = 2 + Math.floor(random() * 7)
    plans.push({
      capital: 3_000 + Math.floor(random() * 37) * 1_000,
      weeks,
      startedDaysAgo: Math.floor(random() * (weeks * 7 - 3)),
      status: LoanStatus.ACTIVE,
      deleted: false,
    })
  }

  // Overdue: ACTIVE, but the due date is already behind us.
  for (let i = 0; i < OVERDUE_LOANS; i += 1) {
    const weeks = 1 + Math.floor(random() * 4)
    plans.push({
      capital: 3_000 + Math.floor(random() * 25) * 1_000,
      weeks,
      startedDaysAgo: weeks * 7 + 5 + Math.floor(random() * 90),
      status: LoanStatus.ACTIVE,
      deleted: false,
    })
  }

  for (let i = 0; i < PAID_LOANS; i += 1) {
    const weeks = 1 + Math.floor(random() * 7)
    plans.push({
      capital: 3_000 + Math.floor(random() * 30) * 1_000,
      weeks,
      startedDaysAgo: weeks * 7 + 10 + Math.floor(random() * 200),
      status: LoanStatus.PAID,
      deleted: false,
    })
  }

  // For the Recently Deleted screen. Soft-deleted, so they are out of every
  // other list and into the bin, each with its own countdown.
  for (let i = 0; i < BIN_LOANS; i += 1) {
    const weeks = 1 + Math.floor(random() * 5)
    plans.push({
      capital: 3_000 + Math.floor(random() * 20) * 1_000,
      weeks,
      startedDaysAgo: weeks * 7 + Math.floor(random() * 60),
      status: LoanStatus.ACTIVE,
      deleted: true,
    })
  }

  const fundingRows: {
    userId: string
    loanId: string
    lenderId: string
    principalCentavos: number
    lenderRateBps: number
    adminCutBps: number
    earningsCentavos: number
    adminCutCentavos: number
  }[] = []
  const payments: { userId: string; loanId: string; paidOn: Date; amountCentavos: number }[] = []

  for (const [index, plan] of plans.entries()) {
    const startOn = daysAgo(plan.startedDaysAgo)
    const dueOn = dueDateAfterWeeks(startOn, plan.weeks)
    const capital = peso(plan.capital)

    const fundings = [
      {
        lenderId: lender.id,
        principal: capital,
        lenderRateBps: LENDER_RATE_BPS,
        adminCutBps: ADMIN_CUT_BPS,
      },
    ]

    // The real money module decides every figure, exactly as in demo.ts. A seed
    // that did its own arithmetic would be describing an app that does not exist.
    const result = splitLoan({
      capital,
      borrowerRateBps: BORROWER_RATE_BPS,
      weeks: plan.weeks,
      fundings,
    })
    if (!result.ok) throw new Error(`Seeded loan ${index} is invalid: ${JSON.stringify(result.error)}`)
    const split = result.value

    const loan = await prisma.loan.create({
      data: {
        userId,
        // Spread across the borrowers, so the borrower list shows a range of
        // track records rather than everything landing on one person.
        borrowerId: borrowers[index % borrowers.length].id,
        capitalCentavos: capital,
        borrowerRateBps: BORROWER_RATE_BPS,
        startOn,
        dueOn,
        termDays: plan.weeks * DAYS_PER_WEEK,
        interestCentavos: split.totalInterest,
        totalCentavos: split.borrowerTotal,
        status: plan.status,
        // Staggered, so the bin's countdowns are not all the same number.
        deletedAt: plan.deleted ? daysAgo(index % 25) : null,
      },
      select: { id: true },
    })

    const share = split.lenders[0]
    fundingRows.push({
      userId,
      loanId: loan.id,
      lenderId: lender.id,
      principalCentavos: capital,
      lenderRateBps: LENDER_RATE_BPS,
      adminCutBps: ADMIN_CUT_BPS,
      earningsCentavos: share.earnings,
      adminCutCentavos: share.adminCut,
    })

    if (plan.status === LoanStatus.PAID) {
      payments.push({ userId, loanId: loan.id, paidOn: dueOn, amountCentavos: split.borrowerTotal })
    }
  }

  await prisma.loanFunding.createMany({ data: fundingRows })
  await prisma.payment.createMany({ data: payments })

  // ── The rest of the bin ───────────────────────────────────────────────────
  // Deleted people with no loans, so they show a real countdown rather than
  // "kept" — a borrower a live loan still points at is never purged.
  await prisma.borrower.createMany({
    data: Array.from({ length: BIN_BORROWERS }, (_, i) => ({
      userId,
      firstName: MARK,
      lastName: `Deleted ${String(i + 1).padStart(2, '0')}`,
      deletedAt: daysAgo(i % 25),
    })),
  })

  // Deleted lenders with no funding rows, so they show a countdown rather than
  // "kept" — a lender whose money is in a live loan is never purged.
  await prisma.lender.createMany({
    data: Array.from({ length: BIN_LENDERS }, (_, i) => ({
      userId,
      firstName: MARK,
      lastName: `Ex-lender ${String(i + 1).padStart(2, '0')}`,
      isSelf: false,
      deletedAt: daysAgo(i % 25),
    })),
  })

  await prisma.lenderTransaction.createMany({
    data: Array.from({ length: BIN_TRANSACTIONS }, (_, i) => ({
      userId,
      lenderId: lender.id,
      type: i % 2 === 0 ? LenderTransactionType.DEPOSIT : LenderTransactionType.WITHDRAWAL,
      amountCentavos: peso(1_000 + i * 500),
      occurredOn: daysAgo(i + 10),
      note: `${MARK} deleted movement ${i + 1}`,
      deletedAt: daysAgo(i % 25),
    })),
  })

  const live = { userId, deletedAt: null }
  console.log('')
  console.log(`  Loans        ${await prisma.loan.count({ where: live })} live` +
    ` (${await prisma.loan.count({ where: { ...live, status: LoanStatus.ACTIVE } })} active,` +
    ` ${await prisma.loan.count({ where: { ...live, status: LoanStatus.PAID } })} paid)`)
  console.log(`  Borrowers    ${await prisma.borrower.count({ where: live })} live`)
  console.log(`  In the bin   ${await prisma.loan.count({ where: { userId, deletedAt: { not: null } } })} loans,` +
    ` ${await prisma.borrower.count({ where: { userId, deletedAt: { not: null } } })} borrowers,` +
    ` ${await prisma.lenderTransaction.count({ where: { userId, deletedAt: { not: null } } })} movements`)
  console.log('')
  console.log(`Undo with:  node --env-file=.env prisma/seed/pagination-clean.ts ${user.username}`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
