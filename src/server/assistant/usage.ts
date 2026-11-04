import { db } from '../db.ts'
import { type GroqHeaders, type ModelRow, type UsageSummary, summarize } from '../../lib/assistant-status.ts'

export { parseDuration, readGroqHeaders, type UsageSummary } from '../../lib/assistant-status.ts'

/**
 * How much of the free Groq allowance Ask Pondex has left, and when a tired
 * model can be used again.
 *
 * Groq reports per-minute figures in its headers but not the daily token count,
 * which is the limit that actually runs out. So every call adds its tokens to
 * today's row, and every refusal overwrites the row with what Groq said: its
 * message carries the real "Limit 200000, Used 199539" and "try again in
 * 14m12s". The count is an estimate between refusals and exact at each one.
 *
 * Days are UTC calendar days. Groq's window is rolling, so near midnight the
 * estimate can be generous; the refusal's own wait is what the countdown shows.
 */

function today(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

const key = (model: string) => ({ day_model: { day: today(), model } })

/** One call's tokens, and whether it finished a question. */
export async function recordCall(model: string, tokens: number, finishedQuestion: boolean) {
  await db.assistantUsage.upsert({
    where: key(model),
    create: { day: today(), model, calls: 1, tokens, questions: finishedQuestion ? 1 : 0 },
    update: { calls: { increment: 1 }, tokens: { increment: tokens }, questions: { increment: finishedQuestion ? 1 : 0 } },
  })
}

/** Groq's figures from the latest answer, and that this model just answered. */
export async function recordHeaders(model: string, figures: GroqHeaders) {
  const set = { ...figures, lastUsedAt: new Date() }
  await db.assistantUsage.upsert({ where: key(model), create: { day: today(), model, ...set }, update: set })
}

export type Refusal = { daily: boolean; waitS: number; used: number | null; limit: number | null }

/**
 * Read a 429 from Groq. The header gives whole seconds; the message is more
 * exact and also names the day's limit and use, e.g.
 * "Limit 200000, Used 199539, Requested 2510. Please try again in 14m12.4s."
 */
export function parseRefusal(message: string, retryAfter: string | null): Refusal {
  const daily = /per day|TPD|RPD/i.test(message)
  const figures = /Limit (\d+), Used (\d+)/.exec(message)
  const wait = /try again in (?:(\d+)h)?(?:(\d+)m)?(?:([\d.]+)s)?/.exec(message)
  const fromMessage = wait ? Number(wait[1] ?? 0) * 3600 + Number(wait[2] ?? 0) * 60 + Number(wait[3] ?? 0) : NaN
  const fromHeader = Number(retryAfter ?? '')
  const waitS = Number.isFinite(fromMessage) && fromMessage > 0 ? fromMessage : Number.isFinite(fromHeader) ? fromHeader : 60
  return {
    daily,
    waitS: Math.ceil(waitS),
    // Only the DAILY figures describe the day; a per-minute refusal's numbers are per minute.
    used: daily && figures ? Number(figures[2]) : null,
    limit: daily && figures ? Number(figures[1]) : null,
  }
}

export async function recordRefusal(model: string, refusal: Refusal) {
  const coolUntil = new Date(Date.now() + refusal.waitS * 1000)
  await db.assistantUsage.upsert({
    where: key(model),
    create: { day: today(), model, coolUntil, tokens: refusal.used ?? 0, tokenLimit: refusal.limit },
    update: {
      coolUntil,
      ...(refusal.used !== null ? { tokens: refusal.used } : {}),
      ...(refusal.limit !== null ? { tokenLimit: refusal.limit } : {}),
    },
  })
}

/** Today's figures for the given models, in the order given, and what the chat header should say. */
export async function usageSummary(models: string[]): Promise<UsageSummary> {
  const day = today()
  const yesterday = new Date(day.getTime() - 86_400_000)
  const rows = await db.assistantUsage.findMany({ where: { day: { gte: yesterday }, model: { in: models } } })
  // Groq's day is a rolling 24 hours: a rest set late yesterday (UTC) can still be running.
  const earlierCool = new Map(rows.filter((r) => r.day.getTime() < day.getTime() && r.coolUntil).map((r) => [r.model, r.coolUntil!]))
  return summarize(models, rows.filter((r) => r.day.getTime() === day.getTime()) as ModelRow[], Date.now(), earlierCool)
}
