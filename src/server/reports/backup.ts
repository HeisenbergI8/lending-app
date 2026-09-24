import { type Centavos, centavos, toPesos } from '../../lib/money/centavos.ts'
import { BPS_DENOMINATOR } from '../../lib/money/centavos.ts'
import { adminTakeOnLoan } from '../../lib/money/split.ts'
import { daysBetween, describeTerm, toDateInput } from '../../lib/money/weeks.ts'
import { loanState } from '../../lib/loan-state.ts'
import { db } from '../db.ts'
import { requestFigures } from '../pending/queries.ts'
import { type CellValue, type Sheet, buildWorkbook, excelSerialDate } from './xlsx.ts'

/**
 * The whole loan book as a spreadsheet, for keeping.
 *
 * NOT A REPORT. Every other thing under Reports answers a question about a
 * period and is shaped for handing to somebody. This is the opposite: every
 * loan on the account, whenever it started, with the columns the screens only
 * show one loan at a time. It exists so the Admin can download one file a month
 * and stop keeping a list by hand.
 *
 * THE PERIOD ON THE REPORTS PAGE DOES NOT APPLY TO IT. A backup of this month
 * is not a backup. The card says so, and the Read me sheet inside the file says
 * so again, because the file outlives the screen it came from.
 *
 * WHAT IS NOT IN IT, and is not an oversight:
 *
 *   Deleted loans, payments and proofs. "Deleted" is a thirty-day holding pen
 *   here, and every figure in the app excludes those rows. A backup that
 *   included them would not agree with any screen. They are in Recently Deleted
 *   until the purge takes them.
 *
 *   An undone payment. Undo archives the Payment row but leaves it attached to
 *   its loan, so it arrives looking like a repayment. Paid on and Amount paid
 *   are blank unless the payment is live, and the loan reads Active — which is
 *   what the loan screen says too.
 *
 * NOTHING HERE RECOMPUTES MONEY. Capital, interest and total are the columns
 * stored when the loan was made; the Admin's share comes from adminTakeOnLoan,
 * the same function the loan screen shows "Admin interest" from. A backup that
 * did its own arithmetic would be a second opinion about the same pesos.
 */

/** A rate as Excel sees a percentage: 700 bps is 0.07, which formats as 7.00%. */
const rateFraction = (bps: number | null): number | null =>
  bps === null ? null : bps / BPS_DENOMINATOR

const pesos = (amount: Centavos): number => toPesos(amount)

const day = (date: Date | null): number | null => (date === null ? null : excelSerialDate(date))

const fullName = (person: { firstName: string; lastName: string }): string =>
  `${person.firstName} ${person.lastName}`

const sum = (amounts: Centavos[]): Centavos =>
  centavos(amounts.reduce<number>((total, amount) => total + amount, 0))

/**
 * How many days past its due date, or null when it is not late.
 *
 * Two different questions behind one column, and both are answered the same way
 * because both are "how far past due": a repaid loan is measured to the day the
 * money arrived and is finished moving, a running one to today and grows.
 */
function daysLate(dueOn: Date, paidOn: Date | null, today: Date): number | null {
  const late = daysBetween(dueOn, paidOn ?? today)
  return late > 0 ? late : null
}

export async function loanBackup(userId: string, now: Date = new Date()): Promise<Buffer> {
  const [loans, pending] = await Promise.all([
    db.loan.findMany({
      where: { userId, deletedAt: null },
      select: {
        id: true,
        capitalCentavos: true,
        interestBasis: true,
        borrowerRateBps: true,
        startOn: true,
        dueOn: true,
        termDays: true,
        interestCentavos: true,
        totalCentavos: true,
        status: true,
        createdAt: true,
        borrower: { select: { firstName: true, lastName: true } },
        payment: {
          select: {
            paidOn: true,
            amountCentavos: true,
            deletedAt: true,
            createdAt: true,
            proofFiles: {
              where: { deletedAt: null },
              select: { storagePath: true },
            },
          },
        },
        fundings: {
          select: {
            principalCentavos: true,
            lenderRateBps: true,
            adminCutBps: true,
            earningsCentavos: true,
            adminCutCentavos: true,
            lender: { select: { firstName: true, lastName: true, isSelf: true } },
          },
        },
        notes: { select: { body: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
      },
      // Oldest first. A ledger reads forwards, and a file appended to month
      // after month should not reorder itself every time.
      orderBy: { startOn: 'asc' },
    }),
    db.pendingLoan.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
  ])

  // An undone payment is archived but still attached to its loan. Resolving it
  // once here is what keeps every sheet below agreeing about whether a loan was
  // repaid.
  const live = loans.map((loan) => ({
    ...loan,
    borrowerName: fullName(loan.borrower),
    payment: loan.payment?.deletedAt === null ? loan.payment : null,
  }))

  const loanRows: CellValue[][] = live.map((loan) => {
    const paidOn = loan.payment?.paidOn ?? null
    const adminTake = adminTakeOnLoan(
      loan.fundings.map((funding) => ({
        adminCut: centavos(funding.adminCutCentavos),
        earnings: centavos(funding.earningsCentavos),
        isSelf: funding.lender.isSelf,
      })),
    )
    // The rest of the interest. Admin take plus this is the loan's stored
    // interest on every row, which is the invariant LoanFunding is built on.
    const lendersTake = sum(
      loan.fundings
        .filter((funding) => !funding.lender.isSelf)
        .map((funding) => centavos(funding.earningsCentavos)),
    )

    return [
      loan.borrowerName,
      loan.status === 'PAID' ? 'Paid' : 'Active',
      // Overdue is ACTIVE with a due date already past — a fact about the day
      // the file was made, not a column. Recomputing it from Due tomorrow gives
      // a different answer, which is why the Read me sheet dates the file.
      loanState(loan.status, loan.dueOn, now) === 'overdue' ? 'Yes' : null,
      daysLate(loan.dueOn, paidOn, now),
      pesos(centavos(loan.capitalCentavos)),
      pesos(centavos(loan.interestCentavos)),
      pesos(centavos(loan.totalCentavos)),
      loan.interestBasis === 'WEEKLY_RATE' ? 'Weekly rate' : 'Fixed amount',
      // Null on a fixed-amount loan, where no rate was ever agreed. Blank rather
      // than 0%, which would read as a rate somebody chose.
      rateFraction(loan.borrowerRateBps),
      day(loan.startOn),
      day(loan.dueOn),
      describeTerm(loan.termDays),
      loan.termDays,
      day(paidOn),
      loan.payment ? pesos(centavos(loan.payment.amountCentavos)) : null,
      loan.payment?.proofFiles.length ?? null,
      loan.fundings
        .map((funding) => (funding.lender.isSelf ? 'Admin' : fullName(funding.lender)))
        .join(', '),
      pesos(adminTake),
      pesos(lendersTake),
      day(loan.createdAt),
      loan.id,
    ]
  })

  const fundingRows: CellValue[][] = live.flatMap((loan) =>
    loan.fundings.map((funding) => [
      loan.borrowerName,
      funding.lender.isSelf ? 'Admin' : fullName(funding.lender),
      funding.lender.isSelf ? 'Yes' : null,
      pesos(centavos(funding.principalCentavos)),
      rateFraction(funding.lenderRateBps),
      rateFraction(funding.adminCutBps),
      pesos(centavos(funding.earningsCentavos)),
      pesos(centavos(funding.adminCutCentavos)),
      loan.id,
    ]),
  )

  const paymentRows: CellValue[][] = live
    .filter((loan) => loan.payment !== null)
    .map((loan) => {
      const payment = loan.payment!
      return [
        loan.borrowerName,
        day(payment.paidOn),
        pesos(centavos(payment.amountCentavos)),
        payment.proofFiles.length,
        // The path inside the storage bucket, not a link. The file itself is
        // never in the database and a signed link would be dead within the hour.
        payment.proofFiles.map((proof) => proof.storagePath).join(', '),
        day(payment.createdAt),
        loan.id,
      ]
    })

  const noteRows: CellValue[][] = live.flatMap((loan) =>
    loan.notes.map((note) => [loan.borrowerName, day(note.createdAt), note.body, loan.id]),
  )

  const pendingRows: CellValue[][] = pending.map((request) => {
    const figures = requestFigures(request)
    return [
      fullName(request),
      pesos(figures.capital),
      rateFraction(request.borrowerRateBps),
      describeTerm(request.termDays),
      request.termDays,
      pesos(figures.interest),
      pesos(figures.total),
      day(request.startOn),
      day(request.createdAt),
    ]
  })

  return buildWorkbook([
    {
      name: 'Loans',
      columns: [
        { header: 'Borrower', type: 'text', width: 22 },
        { header: 'Status', type: 'text', width: 9 },
        { header: 'Overdue', type: 'text', width: 9 },
        { header: 'Days late', type: 'number', width: 10 },
        { header: 'Capital', type: 'money', width: 14 },
        { header: 'Interest', type: 'money', width: 14 },
        { header: 'Total due', type: 'money', width: 14 },
        { header: 'Interest basis', type: 'text', width: 14 },
        { header: 'Borrower rate a week', type: 'percent', width: 18 },
        { header: 'Start', type: 'date', width: 12 },
        { header: 'Due', type: 'date', width: 12 },
        { header: 'Term', type: 'text', width: 16 },
        { header: 'Term days', type: 'number', width: 10 },
        { header: 'Paid on', type: 'date', width: 12 },
        { header: 'Amount paid', type: 'money', width: 14 },
        { header: 'Proof files', type: 'number', width: 10 },
        { header: 'Funded by', type: 'text', width: 30 },
        { header: "Admin's interest", type: 'money', width: 15 },
        { header: "Lenders' interest", type: 'money', width: 15 },
        { header: 'Recorded on', type: 'date', width: 12 },
        { header: 'Loan ID', type: 'text', width: 26 },
      ],
      rows: loanRows,
    },
    {
      name: 'Funding',
      columns: [
        { header: 'Borrower', type: 'text', width: 22 },
        { header: 'Funder', type: 'text', width: 22 },
        { header: "Admin's own money", type: 'text', width: 17 },
        { header: 'Principal', type: 'money', width: 14 },
        { header: 'Funder rate a week', type: 'percent', width: 17 },
        { header: "Admin's cut a week", type: 'percent', width: 17 },
        { header: 'Funder interest', type: 'money', width: 15 },
        { header: "Admin's cut", type: 'money', width: 14 },
        { header: 'Loan ID', type: 'text', width: 26 },
      ],
      rows: fundingRows,
    },
    {
      name: 'Payments',
      columns: [
        { header: 'Borrower', type: 'text', width: 22 },
        { header: 'Paid on', type: 'date', width: 12 },
        { header: 'Amount', type: 'money', width: 14 },
        { header: 'Proof files', type: 'number', width: 10 },
        { header: 'Proof file paths', type: 'text', width: 44 },
        { header: 'Recorded on', type: 'date', width: 12 },
        { header: 'Loan ID', type: 'text', width: 26 },
      ],
      rows: paymentRows,
    },
    {
      name: 'Pending requests',
      columns: [
        { header: 'Name', type: 'text', width: 22 },
        { header: 'Capital asked for', type: 'money', width: 16 },
        { header: 'Rate a week', type: 'percent', width: 12 },
        { header: 'Term', type: 'text', width: 16 },
        { header: 'Term days', type: 'number', width: 10 },
        { header: 'Interest at that rate', type: 'money', width: 18 },
        { header: 'Total on those terms', type: 'money', width: 18 },
        { header: 'Start on', type: 'date', width: 12 },
        { header: 'Requested on', type: 'date', width: 12 },
      ],
      rows: pendingRows,
    },
    {
      name: 'Notes',
      columns: [
        { header: 'Borrower', type: 'text', width: 22 },
        { header: 'Written on', type: 'date', width: 12 },
        { header: 'Note', type: 'text', width: 70 },
        { header: 'Loan ID', type: 'text', width: 26 },
      ],
      rows: noteRows,
    },
    readMe(now, loanRows.length, pendingRows.length),
  ])
}

/**
 * What this file is, inside the file.
 *
 * The card on the Reports page says the period does not apply and that deleted
 * loans are left out. Six months from now the file is on a hard drive and the
 * card is not, so it says it here too. Overdue and Days late in particular are
 * answers about the day the file was made, and are wrong to read as anything
 * else.
 */
function readMe(now: Date, loanCount: number, pendingCount: number): Sheet {
  const rows: CellValue[][] = [
    ['Downloaded on', toDateInput(now)],
    ['Covers', 'Every loan on this account, whenever it started. The period on the Reports page does not apply.'],
    ['Loans sheet', `${loanCount} loans, active and paid. One row each, with the funders named.`],
    ['Funding sheet', "One row per funder per loan: their principal, their rate, what they earned, and the Admin's cut on it."],
    ['Payments sheet', 'Repayments that stand. A payment that was undone is not here and its loan reads Active.'],
    ['Pending requests', `${pendingCount} requests nobody has funded yet. Their interest and total are worked out at the rate stored today, not fixed.`],
    ['Notes sheet', "The Admin's own remarks on a loan. No figure anywhere adds these up."],
    ['Not included', 'Deleted loans, payments and proofs. Those sit in Recently Deleted for thirty days and then go for good.'],
    ['Overdue and Days late', `Worked out against ${toDateInput(now)}. A running loan gets later every day, so these two go stale; every other column does not.`],
    ['Money', 'Pesos, formatted as pesos. Columns add up.'],
  ]

  return {
    name: 'Read me',
    columns: [
      { header: 'About this file', type: 'text', width: 24 },
      { header: '', type: 'text', width: 110 },
    ],
    rows,
  }
}
