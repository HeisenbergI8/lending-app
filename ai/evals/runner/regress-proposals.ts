import { db } from '../../../src/server/db.ts'
import { runTool } from '../../../src/server/assistant/tools.ts'
const demo = (await db.user.findFirst({ where: { username: 'demo' }, select: { id: true, isDemo: true } }))!
if (!demo.isDemo) throw new Error('SAFETY STOP')
const U = demo.id
const out: [string, boolean, string][] = []
const t = async (name: string, tool: string, args: object, ok: (r: any) => boolean) => {
  const r: any = await runTool(U, tool, args as Record<string, unknown>)
  out.push([name, ok(r), JSON.stringify(r).slice(0, 160)])
}
const rico = (await db.borrower.findFirst({ where: { userId: U, firstName: 'Rico' } }))!
const anyLoan = (await db.loan.findFirst({ where: { userId: U, deletedAt: null } }))!
await t('find_borrower typo offers did-you-mean', 'find_borrower', { name: 'Ricco Mendosa' }, (r) => !r.found && r.didYouMean?.[0]?.name === 'Rico Mendoza')
await t('find_borrower first name only typo', 'find_borrower', { name: 'Angle' }, (r) => r.didYouMean?.[0]?.name === 'Angel Dela Cruz')
await t('find_borrower stranger: plain not found', 'find_borrower', { name: 'Juan Santos' }, (r) => !r.found && !r.didYouMean)
await t('find_borrower exact still works', 'find_borrower', { name: 'Rico' }, (r) => r.found && r.borrowers.length === 1)
await t('get_lender typo offers did-you-mean', 'get_lender', { name: 'Mariaa Kruz' }, (r) => !r.found && r.didYouMean?.[0]?.name === 'Maria Cruz')
await t('get_lender exact', 'get_lender', { name: 'Jun' }, (r) => r.found && r.name === 'Jun Reyes')
await t('propose look-alike new borrower warns on card', 'propose_action', { action: 'create_borrower', fields: { firstName: 'Ricco', lastName: 'Mendosa' } }, (r) => r.proposal?.lines.some((l: any) => l.label.includes('Already on the list') && l.value.includes('Rico Mendoza')))
await t('propose truly new borrower: no warning', 'propose_action', { action: 'create_borrower', fields: { firstName: 'Juan', lastName: 'Santos' } }, (r) => r.proposal && !r.proposal.lines.some((l: any) => l.label.includes('Already')))
await t('propose made-up payment id blocked', 'propose_action', { action: 'add_payment_proof', fields: { loanId: anyLoan.id, paymentId: 'fake-id' } }, (r) => /Not found/.test(r.error ?? ''))
await t('propose made-up proof file id blocked', 'propose_action', { action: 'delete_payment_proof', fields: { proofFileId: 'fake-id' } }, (r) => /Not found/.test(r.error ?? ''))
await t('propose made-up extension id blocked', 'propose_action', { action: 'undo_extension', fields: { extensionId: 'fake-id' } }, (r) => /Not found/.test(r.error ?? ''))
await t('propose made-up loan proof id blocked', 'propose_action', { action: 'delete_loan_proof', fields: { loanProofId: 'fake-id' } }, (r) => /Not found/.test(r.error ?? ''))
await t('propose photo removal with no photo', 'propose_action', { action: 'clear_borrower_photo', fields: { borrowerId: rico.id } }, (r) => /no photo/.test(r.error ?? ''))
await t('propose bad amount blocked', 'propose_action', { action: 'add_note', fields: { loanId: anyLoan.id, body: 'x' } }, (r) => !!r.proposal)
await t('propose extend paid now: card needs file', 'propose_action', { action: 'extend_loan', fields: { loanId: anyLoan.id, weeks: '1', paidNow: 'yes' } }, (r) => r.proposal?.files?.required === true)
await t('propose rate 7% shows once', 'propose_action', { action: 'create_loan', fields: { borrowerId: rico.id, capital: '1000', startOn: '2026-11-04', dueOn: '2026-11-11', borrowerRate: '7%' }, funders: [{ lenderId: (await db.lender.findFirst({ where: { userId: U, isSelf: true } }))!.id, amount: '1000' }] }, (r) => r.proposal?.lines.some((l: any) => l.value === '7% a week'))
await t('propose request by dates', 'propose_action', { action: 'create_request', fields: { borrowerId: rico.id, capital: '5000', termChoice: 'custom', startOn: '2026-11-04', dueOn: '2026-11-18' } }, (r) => !!r.proposal)
const maria = (await db.lender.findFirst({ where: { userId: U, firstName: 'Maria' } }))!
await t('names instead of ids, today + 4 weeks', 'propose_action', { action: 'create_loan', fields: { borrowerId: 'Lyn Bautista', capital: '5000', startOn: 'today', weeks: '4' }, funders: [{ lender: 'Maria', amount: '5000' }] },
  (r) => r.proposal?.fields.borrowerId !== 'Lyn Bautista' && r.proposal?.funders[0].lenderId === maria.id && r.proposal.lines.some((l: any) => l.label === 'Borrower' && l.value === 'Lyn Bautista') && /2026-12-0[1-3]/.test(r.proposal.fields.dueOn))
await t('misspelled lender name resolves to the one close match', 'propose_action', { action: 'create_loan', fields: { borrowerId: 'Lyn', capital: '5000', startOn: 'today', weeks: '2' }, funders: [{ lenderId: 'Mariia Cruz', amount: '5000' }] },
  (r) => r.proposal?.funders[0].lenderId === maria.id)
await t('two possible lenders is never a guess', 'propose_action', { action: 'create_loan', fields: { borrowerId: 'Lyn', capital: '5000', startOn: 'today', weeks: '2' }, funders: [{ lenderId: 'J', amount: '5000' }] },
  (r) => /Not found/.test(r.error ?? ''))
await t('made-up lender id still refused', 'propose_action', { action: 'record_money', fields: { lenderId: 'cmzzzzzzzzzzzzzzzzzzzzzzz', type: 'DEPOSIT', amount: '100', occurredOn: 'today' } }, (r) => /Not found/.test(r.error ?? ''))
await db.$disconnect()
for (const [n, p, r] of out) console.log(p ? 'PASS' : 'FAIL', n.padEnd(46), p ? '' : r)
console.log(`\n${out.filter((x) => x[1]).length}/${out.length} passed`)
