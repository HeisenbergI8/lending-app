import { db } from '../db.ts'

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

/** Groq's published free daily token limit, used until a refusal states the real one. */
const DEFAULT_DAILY_TOKENS = 200_000
/** What a question costs before there is any history to average. Measured 2026-11-03: ~2,200. */
const DEFAULT_TOKENS_PER_QUESTION = 2_500

export type ModelUsage = { model: string; used: number; limit: number; coolUntil: Date | null }
export type UsageSummary = {
  /** About how many more questions fit in today's allowance, across every model. */
  questionsLeft: number
  /** When the first model is free again, or null when one is free now. */
  coolUntil: Date | null
  models: ModelUsage[]
  /** True when the chat runs on the Mac's own model, which has no daily limit. */
  local?: boolean
}

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

/** Today's figures for the given models, in the order given. */
export async function usageSummary(models: string[]): Promise<UsageSummary> {
  const rows = await db.assistantUsage.findMany({ where: { day: today(), model: { in: models } } })
  const byModel = new Map(rows.map((row) => [row.model, row]))
  const now = Date.now()

  const perModel: ModelUsage[] = models.map((model) => {
    const row = byModel.get(model)
    const cool = row?.coolUntil && row.coolUntil.getTime() > now ? row.coolUntil : null
    return { model, used: row?.tokens ?? 0, limit: row?.tokenLimit ?? DEFAULT_DAILY_TOKENS, coolUntil: cool }
  })

  // The average comes from rows this app counted itself. A row a refusal
  // overwrote holds Groq's rolling total, which includes tokens from before
  // the row existed, so dividing it by today's questions overstates a question.
  const counted = rows.filter((row) => row.tokenLimit === null)
  const questions = counted.reduce((n, row) => n + row.questions, 0)
  const tokens = counted.reduce((n, row) => n + row.tokens, 0)
  const perQuestion = questions >= 3 ? Math.max(500, tokens / questions) : DEFAULT_TOKENS_PER_QUESTION

  // A model resting for more than a few minutes was refused for the DAY, so it
  // has nothing left whatever the count says. A per-minute rest is seconds.
  const left = perModel.reduce(
    (n, m) => n + (m.coolUntil && m.coolUntil.getTime() - now > 5 * 60_000 ? 0 : Math.max(0, m.limit - m.used)),
    0,
  )
  const free = perModel.some((m) => m.coolUntil === null)

  return {
    questionsLeft: Math.floor(left / perQuestion),
    coolUntil: free ? null : new Date(Math.min(...perModel.map((m) => m.coolUntil!.getTime()))),
    models: perModel,
  }
}
