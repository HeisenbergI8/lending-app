/**
 * Seeds the DEMO account only.
 *
 * The public CV link needs something to look at, and a recruiter must never see
 * a real borrower's name and how much they owe. So this writes fictional people
 * into the account flagged isDemo, and never touches the real one.
 *
 * Safe to re-run: it wipes the demo user's rows and rebuilds them. Every write
 * is scoped by that user's id, so a real account in the same database is not
 * reachable from here even by accident.
 *
 *   node --env-file=.env prisma/seed/demo.ts
 */

import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, LenderTransactionType, LoanStatus, BorrowerLabel } from '@prisma/client'
import { scryptSync, randomBytes } from 'node:crypto'

import { centavos } from '../../src/lib/money/centavos.ts'
import { splitLoan } from '../../src/lib/money/split.ts'
import { calendarDate, dueDateAfterWeeks } from '../../src/lib/money/weeks.ts'

const DEMO_USERNAME = 'demo'
const DEMO_PASSWORD = 'demo1234'

const peso = (n: number) => centavos(Math.round(n * 100))

/** Same scheme the app's auth will use: scrypt with a per-password salt. */
function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const derived = scryptSync(password, salt, 64).toString('hex')
  return `scrypt:${salt}:${derived}`
}

/**
 * A date N days before today, so the demo always looks current.
 *
 * Through calendarDate, like every other date the app stores — a Date built at
 * local midnight is written to a Postgres `date` column as the day BEFORE from
 * any zone east of Greenwich. See src/lib/money/weeks.ts.
 */
function daysAgo(days: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return calendarDate(d)
}

// Seeding does bulk writes; the session connection (DIRECT_URL) suits that better
// than the transaction pooler, which resets state between statements.
const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL
if (!url) throw new Error('Neither DIRECT_URL nor DATABASE_URL is set. See .env.example.')

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })

type LoanPlan = {
  borrower: string
  capital: number
  weeks: number
  startedDaysAgo: number
  /** lender key -> pesos contributed */
  funding: Record<string, number>
  paid: boolean
}

async function main() {
  console.log('Seeding the demo account...')

  const user = await prisma.user.upsert({
    where: { username: DEMO_USERNAME },
    update: { passwordHash: hashPassword(DEMO_PASSWORD), isDemo: true },
    create: { username: DEMO_USERNAME, passwordHash: hashPassword(DEMO_PASSWORD), isDemo: true },
  })

  if (!user.isDemo) {
    throw new Error(`Refusing to seed: user "${DEMO_USERNAME}" is not flagged isDemo.`)
  }
  const userId = user.id

  // Wipe this user's data only. Order matters — children before parents.
  await prisma.proofFile.deleteMany({ where: { userId } })
  await prisma.payment.deleteMany({ where: { userId } })
  await prisma.loanFunding.deleteMany({ where: { userId } })
  await prisma.loan.deleteMany({ where: { userId } })
  await prisma.lenderTransaction.deleteMany({ where: { userId } })
  await prisma.borrower.deleteMany({ where: { userId } })
  await prisma.lender.deleteMany({ where: { userId } })

  // ── Lenders ────────────────────────────────────────────────────────────────
  // "You" is the admin's own pot: isSelf, and its money earns the full borrower
  // rate because there is no lender to pay a share to.
  const lenderSpec: { key: string; firstName: string; lastName: string; isSelf: boolean; deposits: number[] }[] = [
    { key: 'self', firstName: 'Demo', lastName: 'Admin', isSelf: true, deposits: [50_000] },
    { key: 'john', firstName: 'John Ross', lastName: 'Santos', isSelf: false, deposits: [100_000, 25_000] },
    { key: 'maria', firstName: 'Maria', lastName: 'Cruz', isSelf: false, deposits: [80_000] },
    { key: 'jun', firstName: 'Jun', lastName: 'Reyes', isSelf: false, deposits: [40_000] },
  ]

  const lenders = new Map<string, string>()
  for (const spec of lenderSpec) {
    const lender = await prisma.lender.create({
      data: { userId, firstName: spec.firstName, lastName: spec.lastName, isSelf: spec.isSelf },
    })
    lenders.set(spec.key, lender.id)

    let day = 180
    for (const amount of spec.deposits) {
      await prisma.lenderTransaction.create({
        data: {
          userId,
          lenderId: lender.id,
          type: LenderTransactionType.DEPOSIT,
          amountCentavos: peso(amount),
          occurredOn: daysAgo(day),
          note: 'Initial capital',
        },
      })
      day -= 45
    }
  }

  // One withdrawal, so the floating-funds figure is not just a sum of deposits.
  await prisma.lenderTransaction.create({
    data: {
      userId,
      lenderId: lenders.get('maria') as string,
      type: LenderTransactionType.WITHDRAWAL,
      amountCentavos: peso(15_000),
      occurredOn: daysAgo(30),
      note: 'Took out earnings',
    },
  })

  // ── Borrowers ──────────────────────────────────────────────────────────────
  const borrowerSpec: { key: string; firstName: string; lastName: string; label: BorrowerLabel | null }[] = [
    { key: 'angel', firstName: 'Angel', lastName: 'Dela Cruz', label: BorrowerLabel.GOOD },
    { key: 'rico', firstName: 'Rico', lastName: 'Mendoza', label: BorrowerLabel.OKAY },
    { key: 'bea', firstName: 'Bea', lastName: 'Villanueva', label: BorrowerLabel.GOOD },
    { key: 'dan', firstName: 'Dan', lastName: 'Aquino', label: BorrowerLabel.BAD },
    { key: 'lyn', firstName: 'Lyn', lastName: 'Bautista', label: null },
  ]

  const borrowers = new Map<string, string>()
  for (const spec of borrowerSpec) {
    const borrower = await prisma.borrower.create({
      data: { userId, firstName: spec.firstName, lastName: spec.lastName, manualLabel: spec.label },
    })
    borrowers.set(spec.key, borrower.id)
  }

  // ── Loans ──────────────────────────────────────────────────────────────────
  // A deliberate mix: paid, active, overdue, split funding, and one funded partly
  // by the admin's own money — so every case the UI must render shows up.
  const plans: LoanPlan[] = [
    { borrower: 'angel', capital: 30_000, weeks: 4, startedDaysAgo: 120, funding: { john: 30_000 }, paid: true },
    { borrower: 'angel', capital: 15_000, weeks: 2, startedDaysAgo: 60, funding: { john: 15_000 }, paid: true },
    { borrower: 'angel', capital: 30_000, weeks: 4, startedDaysAgo: 14, funding: { maria: 20_000, jun: 10_000 }, paid: false },
    { borrower: 'rico', capital: 20_000, weeks: 4, startedDaysAgo: 21, funding: { self: 10_000, john: 10_000 }, paid: false },
    { borrower: 'bea', capital: 50_000, weeks: 8, startedDaysAgo: 90, funding: { john: 30_000, maria: 20_000 }, paid: true },
    { borrower: 'bea', capital: 25_000, weeks: 4, startedDaysAgo: 7, funding: { self: 25_000 }, paid: false },
    // Overdue: started 70 days ago on a 4-week term, still unpaid.
    { borrower: 'dan', capital: 12_000, weeks: 4, startedDaysAgo: 70, funding: { jun: 12_000 }, paid: false },
    { borrower: 'lyn', capital: 8_000, weeks: 1, startedDaysAgo: 3, funding: { maria: 8_000 }, paid: false },
  ]

  const BORROWER_RATE_BPS = 700
  const LENDER_RATE_BPS = 500
  const ADMIN_CUT_BPS = 200

  for (const plan of plans) {
    const startOn = daysAgo(plan.startedDaysAgo)
    const dueOn = dueDateAfterWeeks(startOn, plan.weeks)

    const fundings = Object.entries(plan.funding).map(([key, amount]) => {
      const isSelf = key === 'self'
      return {
        lenderId: lenders.get(key) as string,
        principal: peso(amount),
        lenderRateBps: isSelf ? BORROWER_RATE_BPS : LENDER_RATE_BPS,
        adminCutBps: isSelf ? 0 : ADMIN_CUT_BPS,
      }
    })

    // The real money module decides every figure. If the seed and the app ever
    // disagreed, the demo would be lying about what the app does.
    const result = splitLoan({
      capital: peso(plan.capital),
      borrowerRateBps: BORROWER_RATE_BPS,
      weeks: plan.weeks,
      fundings,
    })
    if (!result.ok) {
      throw new Error(`Demo loan for ${plan.borrower} is invalid: ${JSON.stringify(result.error)}`)
    }
    const split = result.value

    const loan = await prisma.loan.create({
      data: {
        userId,
        borrowerId: borrowers.get(plan.borrower) as string,
        capitalCentavos: peso(plan.capital),
        borrowerRateBps: BORROWER_RATE_BPS,
        startOn,
        dueOn,
        weeks: plan.weeks,
        interestCentavos: split.totalInterest,
        totalCentavos: split.borrowerTotal,
        status: plan.paid ? LoanStatus.PAID : LoanStatus.ACTIVE,
      },
    })

    for (const funding of fundings) {
      const share = split.lenders.find((l) => l.lenderId === funding.lenderId)
      if (!share) throw new Error('split did not return a share for a funder')
      await prisma.loanFunding.create({
        data: {
          userId,
          loanId: loan.id,
          lenderId: funding.lenderId,
          principalCentavos: funding.principal,
          lenderRateBps: funding.lenderRateBps,
          adminCutBps: funding.adminCutBps,
          earningsCentavos: share.earnings,
          adminCutCentavos: share.adminCut,
        },
      })
    }

    if (plan.paid) {
      await prisma.payment.create({
        data: {
          userId,
          loanId: loan.id,
          paidOn: dueOn,
          amountCentavos: split.borrowerTotal,
        },
      })
      // Deliberately no ProofFile rows: the UI's "no proof attached" warning
      // needs a case to show, and uploading fake screenshots here would mean
      // shipping binary files nobody can verify.
    }
  }

  const counts = {
    lenders: await prisma.lender.count({ where: { userId } }),
    borrowers: await prisma.borrower.count({ where: { userId } }),
    loans: await prisma.loan.count({ where: { userId } }),
    paid: await prisma.loan.count({ where: { userId, status: LoanStatus.PAID } }),
  }

  console.log(`  ${counts.lenders} lenders, ${counts.borrowers} borrowers, ${counts.loans} loans (${counts.paid} paid)`)
  console.log(`  login: ${DEMO_USERNAME} / ${DEMO_PASSWORD}`)
  console.log('Done.')
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
