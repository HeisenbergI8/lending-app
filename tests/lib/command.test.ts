import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { amountsIn, daySaid, monthsBack, periodSaid, periodsSaid, readDate, entryRef, labelSaid, lengthSaid, loanRef, newNameSaid, noteBodySaid, rateSaid, weekNumberSaid } from '../../src/lib/command/read.ts'
import { intentByRules, isQuestion } from '../../src/lib/command/intents.ts'

const TODAY = '2026-11-04' // a Wednesday

describe('reading amounts, the many ways people write them', () => {
  test('k, commas, peso sign, words, libo', () => {
    assert.deepEqual(amountsIn('lend Rico 10k'), [10000])
    assert.deepEqual(amountsIn('₱10,000.00 from Maria'), [10000])
    assert.deepEqual(amountsIn('lend rico 1.5k'), [1500])
    assert.deepEqual(amountsIn('lend Rico twenty thousand'), [20000])
    assert.deepEqual(amountsIn('pahiram 10 libo'), [10000])
  })
  test('dates, lengths, week numbers and rates are never read as amounts', () => {
    assert.deepEqual(amountsIn('lend Rico 10k for 3 weeks starting Nov 18 at 8%'), [10000])
    assert.deepEqual(amountsIn('Lyn paid week 2'), [])
    assert.deepEqual(amountsIn('undo Angel (the ₱15,000.00 loan from September 05, 2026)'), [])
  })
})

describe('reading days and lengths', () => {
  test('today, yesterday, tomorrow, Taglish', () => {
    assert.equal(daySaid('paid today', TODAY, 'past'), TODAY)
    assert.equal(daySaid('bayad kahapon', TODAY, 'past'), '2026-11-03')
    assert.equal(daySaid('starting bukas', TODAY, 'future'), '2026-11-05')
  })
  test('a weekday is the last one for a payment, the next one for a loan start', () => {
    assert.equal(daySaid('paid on Monday', TODAY, 'past'), '2026-11-02')
    assert.equal(daySaid('starting Friday', TODAY, 'future'), '2026-11-06')
  })
  test('found on the testing link: the lender Jun is not the month June', () => {
    assert.equal(daySaid('pautang kay Lyn 2k galing kay Jun 1 linggo', TODAY, 'future'), null)
    assert.equal(daySaid('lend Lyn 2k from Jun 1 week', TODAY, 'future'), null)
    assert.deepEqual(amountsIn('lend Lyn 2k galing kay Jun 2k'), [2000, 2000])
    assert.deepEqual(lengthSaid('lend Lyn 2k from Jun 1 week', TODAY), { weeks: 1 })
    assert.equal(daySaid('lend Rico 10k starting Jun 30', TODAY, 'future'), '2027-06-30')
    assert.equal(daySaid('lend Rico 10k starting Nov 20', TODAY, 'future'), '2026-11-20')
    assert.equal(daySaid('paid on Jun 30', TODAY, 'past'), '2026-06-30')
    assert.equal(readDate('Nov 11, 2026', TODAY), '2026-11-11')
    assert.equal(daySaid('paid on November 03, 2026', TODAY, 'past'), '2026-11-03')
  })
  test("found on the testing link: a button's loan reference is not the payment date", () => {
    assert.equal(daySaid('Lyn paid in full (the ₱8,000.00 loan from November 01, 2026)', TODAY, 'past'), null)
  })
  test('found on the testing link: one more week is one week', () => {
    assert.deepEqual(lengthSaid('Rico asked for one more week', TODAY), { weeks: 1 })
    assert.deepEqual(lengthSaid('give Lyn another week', TODAY), { weeks: 1 })
    assert.deepEqual(lengthSaid('2 more weeks', TODAY), { weeks: 2 })
  })
  test('a due date is never read as the start', () => assert.equal(daySaid('lend Rico 10k due Nov 30', TODAY, 'future'), null))
  test('weeks, days, due dates, months', () => {
    assert.deepEqual(lengthSaid('for 3 weeks', TODAY), { weeks: 3 })
    assert.deepEqual(lengthSaid('two wks', TODAY), { weeks: 2 })
    assert.deepEqual(lengthSaid('2 linggo', TODAY), { weeks: 2 })
    assert.deepEqual(lengthSaid('10 days', TODAY), { days: 10 })
    assert.deepEqual(lengthSaid('until Nov 30', TODAY), { dueOn: '2026-11-30' })
    assert.deepEqual(lengthSaid('for 1 month', TODAY), { months: 1 })
  })
  test('week numbers, rates, labels', () => {
    assert.equal(weekNumberSaid('Lyn paid week 2'), 2)
    assert.equal(weekNumberSaid('3rd week'), 3)
    assert.equal(rateSaid('at 8% a week'), 8)
    assert.equal(labelSaid('Angel is a bad payer'), 'BAD')
    assert.equal(labelSaid('clear her label'), '')
    assert.equal(labelSaid("clear Lyn's label"), '')
  })
})

describe('reading names, notes and button references', () => {
  test('Filipino surnames keep their particle', () => {
    assert.deepEqual(newNameSaid('add borrower Juan Dela Cruz', /\bborrower\b/i), { firstName: 'Juan', lastName: 'Dela Cruz' })
    assert.deepEqual(newNameSaid('add lender ana de los santos', /\blender\b/i), { firstName: 'Ana', lastName: 'De Los Santos' })
  })
  test('note words after a colon or in quotes', () => {
    assert.equal(noteBodySaid("note on Dan's loan: will pay Friday"), 'will pay Friday')
    assert.equal(noteBodySaid('add a note to Rico "asked for more time"'), 'asked for more time')
  })
  test('the references a button adds read back exactly', () => {
    assert.deepEqual(loanRef('Rico paid (the ₱20,000.00 loan from October 14, 2026)'), { capital: 20000, start: 'October 14, 2026' })
    assert.deepEqual(entryRef('fix it (the deposit of ₱5,000.00 on November 03, 2026) to 6k'), { type: 'DEPOSIT', amount: 5000, date: 'November 03, 2026' })
  })
})

describe('what the Admin wants, by rules (words, Taglish, typos)', () => {
  const cases: [string, string | null][] = [
    ['lend Rico 10k from Maria for 3 weeks', 'create_loan'],
    ['pahiram kay Rico 10k galing kay Maria 2 weeks', 'create_loan'],
    ['kend Rico 10k from Maria', 'create_loan'],
    ['can you front Rico 8k for two weeks from Jun', 'create_loan'],
    ['add a loan for Rico 5k from Maria', 'create_loan'],
    ['Rico wants to borrow 10k for 4 weeks', 'create_request'],
    ['Lyn paid week 2', 'mark_week_paid'],
    ['hulog ni Lyn this week', 'mark_week_paid'],
    ['Dan fully paid', 'mark_paid'],
    ['Bea returned everything she borrowed', 'mark_paid'],
    ['Rico asked for one more week', 'extend_loan'],
    ['scratch that loan for Dan', 'delete'],
    ['remember Rico pays on Saturdays', 'add_note'],
    ['Angel will now pay interest every week', 'convert_to_weekly'],
    ['Lyn paid', 'paid_unclear'],
    ['undo Lyn week 2', 'undo_week_paid'],
    ['undo Dan payment', 'undo_payment'],
    ['Dan did not really pay, reverse it', 'undo_payment'],
    ['Dan payed', 'paid_unclear'],
    ['Maria deposited 5000', 'deposit'],
    ['Maria topped up 10k', 'deposit'],
    ['Jun withdrew 2000', 'withdraw'],
    ['Jun pulled out 1500', 'withdraw'],
    ['make Lyn Bad', 'set_label'],
    ['Lyn paid this week, she is good', 'mark_week_paid'],
    ['note on Rico loan: asked for more time', 'add_note'],
    ['extend Rico loan 2 weeks', 'extend_loan'],
    ['delete Dan loan', 'delete'],
    ['restore Dan loan', 'restore'],
    ['fix Maria deposit to 6k', 'update_money'],
    ['change Rico loan to 12k', 'update_loan'],
    ['add borrower Juan Dela Cruz', 'create_borrower'],
    ['set Maria starting capital to 50k', 'set_starting_capital'],
    ['how much does Angel owe?', null],
    ['who is overdue', null],
    ['what is the capital of France?', null],
  ]
  for (const [text, want] of cases) test(text, () => assert.equal(intentByRules(text), want))
  test('a request said politely is still a request', () => assert.equal(isQuestion('can you lend Rico 10k from Maria'), false))
})

describe('reading a stretch of time (for earnings questions)', () => {
  test('this month, "this month alone", last month', () => {
    assert.deepEqual(periodSaid('how much did John Ross earn this month', TODAY), { from: '2026-11-01', to: '2026-11-04', label: 'this month' })
    // Money still to come in a month said by name looks to its last day, like "this month" does.
    assert.deepEqual(periodSaid("what's still to be collected from John Ross's loans in November", TODAY), { from: '2026-11-01', to: '2026-11-30', label: 'November 2026' })
    assert.deepEqual(periodSaid('which loans are due in November', TODAY), { from: '2026-11-01', to: '2026-11-30', label: 'November 2026' })
    assert.deepEqual(periodSaid('how much did John Ross earn in November', TODAY), { from: '2026-11-01', to: '2026-11-04', label: 'November 2026' })
    assert.deepEqual(periodSaid('How much does john ross earned for this month alone', TODAY), { from: '2026-11-01', to: '2026-11-04', label: 'this month' })
    assert.deepEqual(periodSaid('earned last month', TODAY), { from: '2026-10-01', to: '2026-10-31', label: 'October 2026' })
  })
  test('a month by name, a later month means last year', () => {
    assert.deepEqual(periodSaid('how much did Maria earn in October?', TODAY), { from: '2026-10-01', to: '2026-10-31', label: 'October 2026' })
    assert.deepEqual(periodSaid('earnings for December', TODAY), { from: '2025-12-01', to: '2025-12-31', label: 'December 2025' })
    assert.deepEqual(periodSaid('earned in Oct 2025', TODAY), { from: '2025-10-01', to: '2025-10-31', label: 'October 2025' })
  })
  test('weeks, days, a range, none', () => {
    assert.deepEqual(periodSaid('this week', TODAY), { from: '2026-11-02', to: '2026-11-04', label: 'this week' })
    assert.deepEqual(periodSaid('last week', TODAY), { from: '2026-10-26', to: '2026-11-01', label: 'last week' })
    assert.deepEqual(periodSaid('from Oct 1 to Oct 15', TODAY), { from: '2026-10-01', to: '2026-10-15', label: 'that time' })
    assert.equal(periodSaid('how much did Maria earn', TODAY), null)
  })
})

describe('reading questions about the screens', () => {
  test('next week and next month look ahead', () => {
    assert.deepEqual(periodSaid('which loans are due next week', TODAY), { from: '2026-11-11', to: '2026-11-17', label: 'next week' })
    assert.deepEqual(periodSaid('who is due next month', TODAY), { from: '2026-12-01', to: '2026-12-31', label: 'December 2026' })
  })
  test('"Maria\'s deposits this month" asks to see something, it is not a new deposit', () => {
    assert.equal(isQuestion("Maria's deposits this month"), true)
    assert.equal(intentByRules("Maria's deposits this month"), null)
    assert.equal(intentByRules('Maria deposited 5000 today'), 'deposit')
    assert.equal(intentByRules("fix Maria's money entry to 6k"), 'update_money')
  })
})

describe('periodSaid: the whole month, days still to come included', () => {
  const T = '2026-11-05'
  const whole = { from: '2026-11-01', to: '2026-11-30', label: 'this whole month' }
  for (const text of [
    'How much did john ross potential earnings from interest for this whole month',
    'interest earned for the entire month',
    'how much will Maria earn this month',
    'expected interest this month',
    'kita ni Maria buong buwan',
  ]) test(text, () => assert.deepEqual(periodSaid(text, T), whole))
  test('this month alone stays to today', () => assert.deepEqual(periodSaid('how much did Maria earn this month', T), { from: '2026-11-01', to: T, label: 'this month' }))
  test('last month is untouched by "will"', () => assert.equal(periodSaid('what will last month look like', T)?.label, 'October 2026'))
  test('the whole of November', () => assert.deepEqual(periodSaid('interest in the whole of November', T), { from: '2026-11-01', to: '2026-11-30', label: 'November 2026' }))
  test('November alone stays to today', () => assert.equal(periodSaid('interest in November', T)?.to, T))
})

describe('periodSaid: money still to come looks to the end of the month', () => {
  const whole = { from: '2026-11-01', to: '2026-11-30', label: 'this whole month' }
  for (const text of ['how many loans to be collected on this month on john ross account?', 'which loans are due this month', 'ano ang babayaran ngayong buwan']) test(text, () => assert.deepEqual(periodSaid(text, '2026-11-05'), whole))
})

describe('periodsSaid and monthsBack: comparisons', () => {
  const T = '2026-11-05'
  test('two months said', () => assert.deepEqual(periodsSaid('how much did john ross earned on oct and nov compare that', T).map((p) => p.label), ['October 2026', 'November 2026']))
  test('this month vs last month', () => assert.deepEqual(periodsSaid('collections this month vs last month', T).map((p) => p.label), ['this month', 'October 2026']))
  test('a range stays one period', () => assert.equal(periodsSaid('how much did Maria earn between Oct 1 and Oct 15', T).length, 1))
  test('last 3 months', () => assert.equal(monthsBack('my earnings for the last 3 months', T), 3))
  test('each month this year', () => assert.equal(monthsBack('loans made each month this year', T), 11))
  test('no months', () => assert.equal(monthsBack('how much did Maria earn in October', T), null))
})
