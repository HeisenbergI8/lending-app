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
const ricoLoan = (await db.loan.findFirst({ where: { userId: U, deletedAt: null, borrower: { firstName: 'Rico' } } }))!
const anyLoanOf = (_name: string) => ricoLoan.id
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
await t('grounding: amount the Admin never said is refused', 'propose_action', { action: 'create_loan', _said: 'lend lyn from maria for 2 weeks', fields: { borrowerId: 'Lyn', capital: '5000', startOn: 'today', weeks: '2' }, funders: [{ lender: 'Maria', amount: '5000' }] }, (r) => /did not say capital/.test(r.error ?? ''))
await t('grounding: lender the Admin never named is refused', 'propose_action', { action: 'create_loan', _said: 'lend lyn 5k for 2 weeks', fields: { borrowerId: 'Lyn', capital: '5000', startOn: 'today', weeks: '2' }, funders: [{ lender: 'Maria', amount: '5000' }] }, (r) => /did not name Maria Cruz/.test(r.error ?? ''))
await t('grounding: said amount and names pass', 'propose_action', { action: 'create_loan', _said: 'lend lyn 5k from maria for 2 weeks', fields: { borrowerId: 'Lyn', capital: '5000', startOn: 'today', weeks: '2' }, funders: [{ lender: 'Maria', amount: '5000' }] }, (r) => !!r.proposal)
await t('grounding: "10k each" makes a 20k loan', 'propose_action', { action: 'create_loan', _said: 'lend rico 10k each from john ross and maria, 4 weeks', fields: { borrowerId: 'Rico', capital: '20000', startOn: 'today', weeks: '4' }, funders: [{ lender: 'John Ross', amount: '10000' }, { lender: 'Maria', amount: '10000' }] }, (r) => !!r.proposal)
await t('grounding: admin pot without its name', 'propose_action', { action: 'create_loan', _said: 'lend bea 5k from my pot, 2 weeks', fields: { borrowerId: 'Bea', capital: '5000', startOn: 'today', weeks: '2' }, funders: [{ lender: 'Demo', amount: '5000' }] }, (r) => !!r.proposal || /Not found/.test(r.error ?? ''))
await t('grounding: wrong borrower on a note is refused', 'propose_action', { action: 'add_note', _said: "note on dan's loan: paid half", fields: { loanId: anyLoanOf('Rico'), body: 'paid half' } }, (r) => /did not name Rico/.test(r.error ?? ''))
await t('grounding: a loan with no length is refused', 'propose_action', { action: 'create_loan', _said: 'lend lyn 5k from maria', fields: { borrowerId: 'Lyn', capital: '5000', startOn: 'today', weeks: '4' }, funders: [{ lender: 'Maria', amount: '5000' }] }, (r) => /how long/.test(r.error ?? ''))
await t('edit: people already on the loan need not be named', 'propose_action', { action: 'update_loan', _said: "move rico's due date to 5 weeks", fields: { loanId: ricoLoan.id, weeks: '5' } }, (r) => !!r.proposal)
await t('extend weekly-rate loan: no typed extra interest on the card', 'propose_action', { action: 'extend_loan', _said: "extend rico's loan 2 weeks, pay later", fields: { loanId: ricoLoan.id, weeks: '2', paidNow: 'no', extraInterest: '560' } }, (r) => !!r.proposal && !r.proposal.lines.some((l: any) => l.label === 'Extra interest'))
await t('exact existing name sent as new becomes that borrower', 'propose_action', { action: 'create_loan', _said: 'lend rico mendoza 5k from maria, 2 weeks', fields: { borrowerFirstName: 'Rico', borrowerLastName: 'Mendoza', capital: '5000', startOn: 'today', weeks: '2' }, funders: [{ lender: 'Maria', amount: '5000' }] }, (r) => r.proposal?.lines.some((l: any) => l.label === 'Borrower' && l.value === 'Rico Mendoza'))
const req = await db.pendingLoan.create({ data: { userId: U, firstName: 'Rico', lastName: 'Mendoza', capitalCentavos: 1500000, borrowerRateBps: 700, termDays: 21 } })
await t('funding a request: its own amount and length count as said', 'propose_action', { action: 'create_loan', _said: "fund rico's request from maria, starting today", fields: { pendingId: req.id, borrowerId: 'Rico', capital: '15000', startOn: 'today', weeks: '3' }, funders: [{ lender: 'Maria', amount: '15000' }] }, (r) => !!r.proposal)
await db.pendingLoan.delete({ where: { id: req.id } })
await db.$disconnect()
for (const [n, p, r] of out) console.log(p ? 'PASS' : 'FAIL', n.padEnd(46), p ? '' : r)
console.log(`\n${out.filter((x) => x[1]).length}/${out.length} passed`)
