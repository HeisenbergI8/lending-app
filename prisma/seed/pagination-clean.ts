/**
 * Removes everything pagination-demo.ts wrote, and nothing else.
 *
 * It finds its targets by the ZZSEED marker — the first name every seeded
 * person carries — and works out from there: the loans of those borrowers, the
 * funding rows and payments of those loans, the transactions of the seeded
 * lender. Nothing is matched by date, by amount or by "looks generated", so a
 * real borrower cannot be swept up by resembling one.
 *
 * It prints what it is about to destroy and requires --yes to do it, because
 * this runs against a real account and deletes rows for good rather than
 * soft-deleting them into Recently Deleted.
 *
 *   node --env-file=.env prisma/seed/pagination-clean.ts <username>        # counts only
 *   node --env-file=.env prisma/seed/pagination-clean.ts <username> --yes  # actually delete
 */

import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

const MARK = 'ZZSEED'

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL
if (!url) throw new Error('Neither DIRECT_URL nor DATABASE_URL is set. See .env.example.')

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })

async function main() {
  const username = process.argv[2]
  const confirmed = process.argv.includes('--yes')
  if (!username) throw new Error('Pass the username: node --env-file=.env prisma/seed/pagination-clean.ts <username> [--yes]')

  const user = await prisma.user.findUnique({ where: { username }, select: { id: true, username: true } })
  if (!user) throw new Error(`No user called "${username}".`)
  const userId = user.id

  // The marker is an EXACT match on firstName. "ZZTEST Late", which this account
  // already had by hand, does not match it and is left alone.
  const borrowers = await prisma.borrower.findMany({ where: { userId, firstName: MARK }, select: { id: true } })
  const lenders = await prisma.lender.findMany({ where: { userId, firstName: MARK }, select: { id: true } })
  const borrowerIds = borrowers.map((b) => b.id)
  const lenderIds = lenders.map((l) => l.id)

  const loans = await prisma.loan.findMany({
    where: { userId, borrowerId: { in: borrowerIds } },
    select: { id: true },
  })
  const loanIds = loans.map((l) => l.id)

  console.log(`Account "${user.username}" — rows carrying the ${MARK} marker:`)
  console.log(`  borrowers     ${borrowerIds.length}`)
  console.log(`  lenders       ${lenderIds.length}`)
  console.log(`  loans         ${loanIds.length}`)
  console.log(`  payments      ${await prisma.payment.count({ where: { userId, loanId: { in: loanIds } } })}`)
  console.log(`  fundings      ${await prisma.loanFunding.count({ where: { userId, loanId: { in: loanIds } } })}`)
  console.log(`  transactions  ${await prisma.lenderTransaction.count({ where: { userId, lenderId: { in: lenderIds } } })}`)

  if (borrowerIds.length === 0 && lenderIds.length === 0) {
    console.log('\nNothing to remove.')
    return
  }

  if (!confirmed) {
    console.log('\nNothing deleted. Re-run with --yes to remove these for good.')
    return
  }

  // Children before parents, the same order demo.ts uses — Loan.borrower and
  // LoanFunding.lender are onDelete: Restrict, so a person cannot go first.
  const proof = await prisma.proofFile.deleteMany({ where: { userId, payment: { loanId: { in: loanIds } } } })
  const paid = await prisma.payment.deleteMany({ where: { userId, loanId: { in: loanIds } } })
  const funded = await prisma.loanFunding.deleteMany({ where: { userId, loanId: { in: loanIds } } })
  const loaned = await prisma.loan.deleteMany({ where: { userId, id: { in: loanIds } } })
  const moved = await prisma.lenderTransaction.deleteMany({ where: { userId, lenderId: { in: lenderIds } } })
  const borrowed = await prisma.borrower.deleteMany({ where: { userId, id: { in: borrowerIds } } })
  const lent = await prisma.lender.deleteMany({ where: { userId, id: { in: lenderIds } } })

  console.log('\nRemoved:')
  console.log(`  ${proof.count} proof files, ${paid.count} payments, ${funded.count} fundings, ${loaned.count} loans`)
  console.log(`  ${moved.count} transactions, ${borrowed.count} borrowers, ${lent.count} lenders`)
  console.log('\nThe account is back to what it was.')
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
