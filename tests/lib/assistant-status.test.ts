import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { type ModelRow, parseDuration, readGroqHeaders, statusLine, summarize } from '../../src/lib/assistant-status.ts'

const MODELS = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b']
const NOW = Date.UTC(2026, 10, 4, 3, 0, 0) // 11:00 AM Manila
const row = (model: string, extra: Partial<ModelRow> = {}): ModelRow => ({
  model, questions: 0, tokens: 0, tokenLimit: null, coolUntil: null,
  requestsLeft: null, requestLimit: null, minuteTokensLeft: null, minuteResetAt: null, lastUsedAt: null, ...extra,
})
const at = (minutes: number) => new Date(NOW + minutes * 60_000)

describe("Groq's headers", () => {
  test('reset times read as seconds', () => {
    assert.equal(parseDuration('7.66s'), 7.66)
    assert.equal(parseDuration('2m59.56s'), 179.56)
    assert.equal(parseDuration('1h2m'), 3720)
    assert.equal(parseDuration('250ms'), 0.25)
    assert.equal(parseDuration(''), null)
    assert.equal(parseDuration(null), null)
  })
  test('requests left today and tokens left this minute are taken as given', () => {
    const headers: Record<string, string> = {
      'x-ratelimit-remaining-requests': '987',
      'x-ratelimit-limit-requests': '1000',
      'x-ratelimit-remaining-tokens': '3500',
      'x-ratelimit-reset-tokens': '30s',
    }
    const h = readGroqHeaders((n) => headers[n] ?? null, NOW)
    assert.deepEqual(h, { requestsLeft: 987, requestLimit: 1000, minuteTokensLeft: 3500, minuteResetAt: new Date(NOW + 30_000) })
  })
  test('missing headers stay unknown, not zero', () => {
    assert.deepEqual(readGroqHeaders(() => null, NOW), { requestsLeft: null, requestLimit: null, minuteTokensLeft: null, minuteResetAt: null })
  })
})

describe('the header status', () => {
  test('nothing used yet: ready on the main model', () => {
    const u = summarize(MODELS, [], NOW)
    assert.equal(u.status, 'ready')
    assert.equal(statusLine(u, NOW), 'Ready · gpt-oss-120b')
  })
  test('main model out for the day: a backup answers, and the header says so', () => {
    const u = summarize(MODELS, [row(MODELS[0], { coolUntil: at(7 * 60), tokenLimit: 200000, tokens: 199000 })], NOW)
    assert.equal(u.status, 'backup')
    assert.equal(statusLine(u, NOW), 'Ready · backup model gpt-oss-20b')
  })
  test('every model on a per-minute rest: busy, with the seconds to wait', () => {
    const u = summarize(MODELS, MODELS.map((m, i) => row(m, { coolUntil: at(1 + i) })), NOW)
    assert.equal(u.status, 'busy')
    assert.equal(statusLine(u, NOW), 'Busy · ready again in 1:00')
  })
  test('every model out for the day: out, with the time in Manila', () => {
    const rows = [row(MODELS[0], { coolUntil: at(7 * 60 + 13) }), row(MODELS[1], { coolUntil: at(4 * 60 + 7) }), row(MODELS[2], { coolUntil: at(5 * 60) })]
    const u = summarize(MODELS, rows, NOW)
    assert.equal(u.status, 'out')
    assert.equal(statusLine(u, NOW), 'Out for today · back at 3:07 PM')
  })
  test('the case that misled us on 2026-11-04: two models out, the third only resting a minute, is busy, not "27 left"', () => {
    const rows = [row(MODELS[0], { coolUntil: at(7 * 60) }), row(MODELS[1], { coolUntil: at(4 * 60) }), row(MODELS[2], { coolUntil: at(1), tokens: 42000 })]
    assert.equal(summarize(MODELS, rows, NOW).status, 'busy')
  })
  test('a model with no requests left today is not free, whatever its tokens say', () => {
    const u = summarize(MODELS, [row(MODELS[0], { requestsLeft: 0 })], NOW)
    assert.equal(u.inUse, MODELS[1])
  })
  test('few requests left on the model in use: running low', () => {
    const u = summarize(MODELS, [row(MODELS[0], { requestsLeft: 12 })], NOW)
    assert.equal(u.status, 'low')
    assert.equal(statusLine(u, NOW), 'Running low today · gpt-oss-120b')
  })
  test("a rest set on yesterday's row still counts", () => {
    const u = summarize(MODELS, [], NOW, new Map([[MODELS[0], at(60)]]))
    assert.equal(u.inUse, MODELS[1])
  })
  test('dates that came through JSON as strings still read', () => {
    assert.equal(statusLine({ status: 'busy', inUse: null, coolUntil: at(2).toISOString() }, NOW), 'Busy · ready again in 2:00')
  })
})
