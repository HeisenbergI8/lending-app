import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { lenderTopic, readQuestion } from '../../src/lib/command/question.ts'

const TODAY = '2026-11-04'
const parts = (text: string) => {
  const q = readQuestion(text, TODAY)
  return q && { metric: q.metric, who: q.who, each: q.each, admin: q.admin, rank: q.rank, countOf: q.countOf, period: q.period?.label ?? null }
}

describe('questions read as parts: what, who, when', () => {
  test('each lender, each pot, investors: one row per lender', () => {
    assert.deepEqual(parts('how much did each lender earn this month?'), { metric: 'earned', who: 'lender', each: true, admin: false, rank: null, countOf: null, period: 'this month' })
    assert.equal(parts('how much did each pot earn last month')?.who, 'lender')
    assert.equal(parts('how much did the investors earn last month')?.each, true)
    assert.equal(parts('how much is floating in each pot')?.metric, 'floating')
    assert.equal(parts('how much does each lender have')?.metric, 'floating')
  })
  test('the figure decides whose it is when no kind of person is said', () => {
    assert.equal(parts('who owes the least?')?.who, 'borrower')
    assert.equal(parts('who earned the most in October?')?.who, 'lender')
    assert.equal(parts('who paid the most last month?')?.rank, 'most')
  })
  test('Taglish and synonyms', () => {
    assert.equal(parts('magkano kinita ng bawat lender nung October')?.metric, 'earned')
    assert.equal(parts('magkano kinita ng bawat lender nung October')?.each, true)
    assert.equal(parts('utang ng lahat ng borrowers?')?.metric, 'owes')
    assert.equal(parts('how much do the clients owe in total?')?.who, 'borrower')
    assert.equal(parts('total profit last month')?.metric, 'earned')
  })
  test('interest still to come is not money owed; out on loan is not floating', () => {
    assert.equal(parts('how much interest is still to come for each lender?')?.metric, 'interestOwed')
    assert.equal(parts("how much of each lender's money is out on loan?")?.metric, 'outOnLoan')
  })
  test('counts', () => {
    assert.equal(parts('how many borrowers are overdue?')?.countOf, 'borrowers')
    assert.equal(parts('how many loans were made in October?')?.countOf, 'loans')
    assert.equal(parts('how many lenders do I have?')?.countOf, 'lenders')
  })
  test('the Admin\'s own pot', () => {
    assert.equal(parts('how much is in my pot?')?.admin, true)
    assert.equal(parts('how much did I earn this month?')?.admin, true)
  })
  test('round 4: "will I", "naibalik", and "may" as "has"', () => {
    assert.equal(parts('how much interest will I still get?')?.admin, true)
    assert.equal(parts('magkano na ang naibalik ni Bea')?.metric, 'paid')
    assert.equal(parts('sino ang may pinakamalaking utang')?.period, null)
    assert.equal(parts('how much did each lender earn in May?')?.period, 'May 2026')
  })
  test('two figures joined go to the AI', () => assert.equal(readQuestion('who is overdue and owes the most?', TODAY), null))
  test('not a figure question', () => assert.equal(readQuestion('what is the capital of France?', TODAY), null))
})

describe('lenderTopic: the lender page, said loosely', () => {
  const cases: [string, ReturnType<typeof lenderTopic>][] = [
    ['give me a report for lender statement all time for John Ross', 'statement'],
    ['show me the statment of jun for october', 'statement'],
    ['tell me about Maria', 'statement'],
    ['kumusta pot ni Jun', 'statement'],
    ["where is Maria's money?", 'breakdown'],
    ['saan napunta pera ni Jun', 'breakdown'],
    ['John Ross pot total', 'breakdown'],
    ["who has Maria's money?", 'loans'],
    ['which loans does jun fund', 'loans'],
    ['sino may hawak ng pera ni maria', 'loans'],
    ["Maria's repaid loans", 'repaid'],
    ['loans jun funded that were paid back', 'repaid'],
    ['what rate does Maria earn?', 'rate'],
    ['ano patong ni john ross', 'rate'],
    ["Maria's starting capital history", 'capital'],
    ['where does my cut come from?', 'cut'],
    ['show my lenders', 'list'],
    ['who are my lenders?', 'list'],
    ['how many loans did Maria fund?', null],
    ['how much did Maria earn this month?', null],
    ['how much does Maria have?', null],
    ["which of maria's loans are due this month", null],
    ['how many loans to be collected on john ross account', null],
  ]
  for (const [text, want] of cases) test(`${text} → ${want}`, () => assert.equal(lenderTopic(text), want))
})
