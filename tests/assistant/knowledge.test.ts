import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { parseSections, rankSections } from '../../src/server/assistant/knowledge.ts'

/**
 * Retrieval over the Ask Pondex rules file, checked without the AI.
 *
 * Run on every edit to ai/knowledge/pondex-rules.md: a reworded heading or a
 * dropped alias can quietly stop a question finding its section, and the model
 * would then answer from general knowledge instead. Each case names the section
 * that must come back first, including the cases that must find NOTHING, where
 * the right answer is "your rules don't say".
 */

const sections = parseSections(readFileSync('ai/knowledge/pondex-rules.md', 'utf8'))
const top = (question: string) => rankSections(sections, question)[0]?.title ?? null
const found = (question: string) => rankSections(sections, question).map((s) => s.title)

describe('the rules file is shaped for retrieval', () => {
  test('every section has an alias line, so it can be found by the words people use', () => {
    const raw = readFileSync('ai/knowledge/pondex-rules.md', 'utf8')
    const missing = raw
      .split(/^## /m)
      .slice(1)
      .filter((chunk) => !chunk.split('\n')[1]?.startsWith('Also called:'))
      .map((chunk) => chunk.split('\n')[0])
    assert.deepEqual(missing, [])
  })

  test('sections stay short, so a lookup does not cost a whole minute of the free plan', () => {
    const long = sections.filter((s) => s.text.length > 1200).map((s) => s.title)
    assert.deepEqual(long, [])
  })

  test('no two sections share a title', () => {
    assert.equal(new Set(sections.map((s) => s.title)).size, sections.length)
  })
})

describe('questions find the right section first', () => {
  const cases: [string, string][] = [
    ['What does floating mean?', 'Floating, out on loan and earned'],
    ['How is interest computed?', 'How interest is worked out'],
    ['What are the usual rates?', 'Usual interest rates'],
    ['Can a borrower pay in parts?', 'Paying a loan'],
    ['Is there a late fee?', 'A loan’s total never changes'.replace('’', "'")],
    ['What is the difference between late and overdue?', 'Loan states'],
    ['How do weekly interest loans work?', 'Weekly-interest loans'],
    ['What is an advance?', 'Advances against a loan'],
    ['What is starting capital?', 'Starting capital'],
    ['How much did my pot earn last month?', 'Earned over a period'],
    ['Can I restore a deleted loan?', 'Deleting'],
    ['What is her phone number?', 'What Pondex does not store'],
    ['Can I download a PDF statement?', 'Reports and backup'],
    ['What is the usual loan length?', "The Admin's own lending rules"],
    ['Can someone have two loans at once?', "The Admin's own lending rules"],
    ['Is there a limit on how much one person can borrow?', "The Admin's own lending rules"],
    ['Can I extend a loan by two weeks?', 'Extending a loan'],
    ['How do reminders work?', 'Remind me every N weeks'],
  ]
  for (const [question, title] of cases) {
    test(question, () => assert.equal(top(question), title))
  }

  test('a label question brings back the rule that decides the label', () => {
    assert.ok(found('Is she Good, Okay or Bad?').includes("The Admin's own lending rules"))
  })
})

describe('questions the rules do not cover find nothing', () => {
  for (const question of ['What is the weather tomorrow?', 'Best adobo recipe']) {
    test(question, () => assert.deepEqual(found(question), []))
  }
})
