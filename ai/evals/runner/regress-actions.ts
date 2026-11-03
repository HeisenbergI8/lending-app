import { readFileSync } from 'node:fs'
import { db } from '../../../src/server/db.ts'
import { runTool } from '../../../src/server/assistant/tools.ts'
import { demoSession } from './client.mjs'

const demo = (await db.user.findFirst({ where: { username: 'demo' }, select: { id: true, isDemo: true } }))!
if (!demo.isDemo) throw new Error('SAFETY STOP: demo user is not flagged isDemo')
const U = demo.id
const png = { name: 'proof.png', mimeType: 'image/png', buffer: readFileSync(process.argv[2]) }
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date())
const plus = (days: number) => { const d = new Date(today + 'T12:00:00'); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10) }
const s = await demoSession()
const results: { step: string; expect: string; got: string; pass: boolean }[] = []
const check = async (step: string, expectOk: boolean | RegExp, run: Promise<{ ok: boolean; error?: string }>) => {
  const r = await run
  const pass = expectOk === true ? r.ok : expectOk === false ? !r.ok : !r.ok && expectOk.test(r.error ?? '')
  results.push({ step, expect: String(expectOk), got: r.ok ? 'ok' : `refused: ${r.error}`, pass })
}

await check('create_borrower', true, s.act('create_borrower', { firstName: 'Reg', lastName: 'Tester' }))
const b = (await db.borrower.findFirst({ where: { userId: U, firstName: 'Reg', lastName: 'Tester' } }))!
await check('rename_borrower', true, s.act('rename_borrower', { borrowerId: b.id, firstName: 'Reg', lastName: 'Testcase' }))
await check('set_label OKAY', true, s.act('set_label', { borrowerId: b.id, label: 'OKAY' }))
await check('set_label clear', true, s.act('set_label', { borrowerId: b.id, label: '' }))
// The chat never proposes this without a photo (regress-proposals). Called directly, the app refuses.
await check('clear_borrower_photo with no photo (app refuses)', /photo/, s.act('clear_borrower_photo', { borrowerId: b.id }))
await check('create_lender', true, s.act('create_lender', { firstName: 'Reg', lastName: 'Lender' }))
const l = (await db.lender.findFirst({ where: { userId: U, firstName: 'Reg', lastName: 'Lender' } }))!
const admin = (await db.lender.findFirst({ where: { userId: U, isSelf: true } }))!
await check('rename_lender', true, s.act('rename_lender', { lenderId: l.id, firstName: 'Reg', lastName: 'Lenderson' }))
await check('set_starting_capital', true, s.act('set_starting_capital', { lenderId: l.id, startingCapital: '1000' }))
await check('record_money deposit', true, s.act('record_money', { lenderId: l.id, type: 'DEPOSIT', amount: '50000', occurredOn: today }))
const tx = (await db.lenderTransaction.findFirst({ where: { userId: U, lenderId: l.id }, orderBy: { createdAt: 'desc' } }))!
await check('update_money', true, s.act('update_money', { transactionId: tx.id, type: 'DEPOSIT', amount: '60000', occurredOn: today }))
await check('delete_money', true, s.act('delete_money', { transactionId: tx.id }))
await check('restore_money', true, s.act('restore_money', { transactionId: tx.id }))
await check('record_money bad amount (refused before card)', /not an amount/, s.act('record_money', { lenderId: l.id, type: 'DEPOSIT', amount: '20k', occurredOn: today }))
await check('create_request weeks', true, s.act('create_request', { borrowerId: b.id, capital: '5000', termChoice: 'weeks', weeks: '3' }))
await check('create_request custom dates (bug 1)', true, s.act('create_request', { borrowerId: b.id, capital: '6000', termChoice: 'custom', startOn: today, dueOn: plus(14) }))
const reqs = await db.pendingLoan.findMany({ where: { userId: U, firstName: 'Reg' } })
await check(`delete_request x${reqs.length}`, true, s.act('delete_request', { pendingId: reqs[0].id }))
if (reqs[1]) await check('delete_request 2', true, s.act('delete_request', { pendingId: reqs[1].id }))

await check('create_loan without file', /screenshot/i, s.act('create_loan', { borrowerId: b.id, capital: '10000', startOn: today, dueOn: plus(21) }, [{ lenderId: l.id, amount: '10000' }]))
await check('create_loan split short (caught before the card)', /add up to/, s.act('create_loan', { borrowerId: b.id, capital: '10000', startOn: today, dueOn: plus(21) }, [{ lenderId: l.id, amount: '9000' }], png))
await check('create_loan over floating', false, s.act('create_loan', { borrowerId: b.id, capital: '900000', startOn: today, dueOn: plus(21) }, [{ lenderId: l.id, amount: '900000' }], png))
await check('create_loan', true, s.act('create_loan', { borrowerId: b.id, capital: '10000', startOn: today, dueOn: plus(21) }, [{ lenderId: l.id, amount: '10000' }], png))
const loan = (await db.loan.findFirst({ where: { userId: U, borrowerId: b.id }, orderBy: { createdAt: 'asc' } }))!
await check('add_note', true, s.act('add_note', { loanId: loan.id, body: 'Regression note' }))
const note = (await db.loanNote.findFirst({ where: { userId: U, loanId: loan.id } }))!
await check('delete_note', true, s.act('delete_note', { noteId: note.id }))
await check('add_loan_proof', true, s.act('add_loan_proof', { loanId: loan.id }, [], png))
const proofs = await db.loanProof.findMany({ where: { userId: U, loanId: loan.id, deletedAt: null } })
await check('delete_loan_proof', true, s.act('delete_loan_proof', { loanProofId: proofs[proofs.length - 1].id }))
const detail: any = await runTool(U, 'get_loan', { loan_id: loan.id })
const { funders, ...edit } = detail.editValues
const before = await db.loan.findUnique({ where: { id: loan.id }, select: { totalCentavos: true, dueOn: true } })
await check('update_loan unchanged', true, s.act('update_loan', { loanId: loan.id, ...edit }, funders))
const after = await db.loan.findUnique({ where: { id: loan.id }, select: { totalCentavos: true, dueOn: true } })
results.push({ step: 'update_loan left loan unchanged', expect: 'same', got: JSON.stringify(after), pass: JSON.stringify(before) === JSON.stringify(after) })
await check('update_loan without funders (bug 5)', /funders/, s.act('update_loan', { loanId: loan.id, ...edit }, []))
await check('convert_to_weekly', true, s.act('convert_to_weekly', { loanId: loan.id }))
await check('mark_week_paid', true, s.act('mark_week_paid', { loanId: loan.id, paidOn: today }))
const wk = (await db.payment.findFirst({ where: { userId: U, loanId: loan.id, deletedAt: null, weekNumber: 1 } }))!
await check('add_payment_proof', true, s.act('add_payment_proof', { loanId: loan.id, paymentId: wk.id }, [], png))
const pf = (await db.proofFile.findFirst({ where: { userId: U, paymentId: wk.id, deletedAt: null } }))!
await check('delete_payment_proof', true, s.act('delete_payment_proof', { proofFileId: pf.id }))
await check('undo_week_paid', true, s.act('undo_week_paid', { loanId: loan.id, weekNumber: '1' }))

await check('create_loan from Admin pot', true, s.act('create_loan', { borrowerId: b.id, capital: '5000', startOn: today, dueOn: plus(14) }, [{ lenderId: admin.id, amount: '5000' }], png))
const loan2 = (await db.loan.findFirst({ where: { userId: U, borrowerId: b.id, capitalCentavos: 500000 } }))!
await check('extend paid now without file (bug 6)', /screenshot|attach/i, s.act('extend_loan', { loanId: loan2.id, weeks: '1', paidNow: 'yes' }))
await check('extend_loan pay later', true, s.act('extend_loan', { loanId: loan2.id, weeks: '1', paidNow: 'no' }))
const ext = await db.loanExtension.findFirst({ where: { userId: U, loanId: loan2.id } }).catch(() => null)
if (ext) await check('undo_extension', true, s.act('undo_extension', { extensionId: ext.id }))
else results.push({ step: 'undo_extension', expect: 'true', got: 'no extension row found', pass: false })
await check('record_advance', true, s.act('record_advance', { loanId: loan2.id, amount: '1000', occurredOn: today }))
await check('mark_paid without file', /screenshot/i, s.act('mark_paid', { loanId: loan2.id, paidOn: today }))
await check('mark_paid', true, s.act('mark_paid', { loanId: loan2.id, paidOn: today }, [], png))
await check('undo_payment', true, s.act('undo_payment', { loanId: loan2.id }))
await check('delete_loan', true, s.act('delete_loan', { loanId: loan2.id }))
await check('restore_loan', true, s.act('restore_loan', { loanId: loan2.id }))
await check('delete_lender', true, s.act('delete_lender', { lenderId: l.id }))
await check('restore_lender', true, s.act('restore_lender', { lenderId: l.id }))
await check('delete_lender Admin pot refused', /cannot be deleted/, s.act('delete_lender', { lenderId: admin.id }))
await check('delete_borrower with unpaid loans', true, s.act('delete_borrower', { borrowerId: b.id, loans: 'unpaid' }))
await check('restore_borrower', true, s.act('restore_borrower', { borrowerId: b.id }))
await check('unknown action', false, s.act('drop_database', {}))

await s.browser.close(); await db.$disconnect()
for (const r of results) console.log(r.pass ? 'PASS' : 'FAIL', r.step.padEnd(44), r.got.slice(0, 120))
console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`)
