/**
 * What the Dex-E header says about the free Groq allowance, from Groq's
 * own figures wherever Groq gives one.
 *
 * Exact, from the headers of every answer: which model answered, requests left
 * today, tokens left this minute and when that minute resets. Exact, from a
 * refusal: the day's token use and limit, and when the model is free again.
 * Groq sends no figure for tokens left today between refusals, so that one is
 * this app's own count, and the details say "about".
 *
 * Pure, and in lib/ rather than beside usage.ts, so the header's wording can
 * be tested without a database.
 */

/** Groq's published free daily token limit, used until a refusal states the real one. */
export const DEFAULT_DAILY_TOKENS = 200_000
/** What a question costs before there is any history to average. Measured 2026-11-04: ~4,500 on gpt-oss-120b. */
export const DEFAULT_TOKENS_PER_QUESTION = 4_500
/** A rest longer than this was a refusal for the DAY; anything shorter is the per-minute limit. */
const DAY_REST_MS = 5 * 60_000

/** "2m59.56s", "7.66s", "1h2m", "250ms" (Groq's reset times) in seconds. Null when it is not one. */
export function parseDuration(text: string | null): number | null {
  const m = /^(?:(\d+)h)?(?:(\d+)m(?!s))?(?:([\d.]+)s)?(?:([\d.]+)ms)?$/.exec((text ?? '').trim())
  if (!m || !m[0]) return null
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) + Number(m[4] ?? 0) / 1000
}

export type GroqHeaders = { requestsLeft: number | null; requestLimit: number | null; minuteTokensLeft: number | null; minuteResetAt: Date | null }

/**
 * Groq's own figures, sent with every answer: requests left today (exact),
 * tokens left this minute (exact) and when the minute resets.
 */
export function readGroqHeaders(get: (name: string) => string | null, now = Date.now()): GroqHeaders {
  const int = (name: string) => {
    const raw = get(name)
    const n = Number(raw ?? '')
    return raw !== null && raw !== '' && Number.isFinite(n) ? Math.round(n) : null
  }
  const reset = parseDuration(get('x-ratelimit-reset-tokens'))
  return {
    requestsLeft: int('x-ratelimit-remaining-requests'),
    requestLimit: int('x-ratelimit-limit-requests'),
    minuteTokensLeft: int('x-ratelimit-remaining-tokens'),
    minuteResetAt: reset === null ? null : new Date(now + reset * 1000),
  }
}

/** One model's row for today, as stored. */
export type ModelRow = {
  model: string
  questions: number
  tokens: number
  tokenLimit: number | null
  coolUntil: Date | null
  requestsLeft: number | null
  requestLimit: number | null
  minuteTokensLeft: number | null
  minuteResetAt: Date | null
  lastUsedAt: Date | null
}

export type ModelUsage = {
  model: string
  /** Tokens used today. Exact when `exact`, else this app's own count. */
  used: number
  limit: number
  exact: boolean
  coolUntil: Date | null
  requestsLeft: number | null
  requestLimit: number | null
  minuteTokensLeft: number | null
  lastUsedAt: Date | null
}

/**
 * ready: the main model answers. backup: a backup model answers. low: little
 * left today. busy: every model hit its per-minute limit (seconds away).
 * out: every model is done for the day. local: the Mac's own model.
 */
export type Status = 'ready' | 'backup' | 'low' | 'busy' | 'out' | 'local'

export type UsageSummary = {
  status: Status
  /** The model the next question goes to, or null when none is free. */
  inUse: string | null
  /** When the first model is free again, or null when one is free now. */
  coolUntil: Date | null
  /** About how many more questions fit in today's allowance, across every model. */
  questionsLeft: number
  models: ModelUsage[]
  /** True when the chat runs on the Mac's own model, which has no daily limit. */
  local?: boolean
}

/**
 * Today's figures and the header's status. `earlierCool` is a rest set on a
 * row from an earlier day that still runs (Groq's day is a rolling 24 hours).
 */
export function summarize(models: string[], rows: ModelRow[], now: number, earlierCool: Map<string, Date> = new Map()): UsageSummary {
  const byModel = new Map(rows.map((row) => [row.model, row]))

  const perModel: ModelUsage[] = models.map((model) => {
    const row = byModel.get(model)
    const cools = [row?.coolUntil, earlierCool.get(model)].filter((d): d is Date => !!d && d.getTime() > now)
    return {
      model,
      used: row?.tokens ?? 0,
      limit: row?.tokenLimit ?? DEFAULT_DAILY_TOKENS,
      exact: row?.tokenLimit !== null && row?.tokenLimit !== undefined,
      coolUntil: cools.length > 0 ? new Date(Math.max(...cools.map((d) => d.getTime()))) : null,
      requestsLeft: row?.requestsLeft ?? null,
      requestLimit: row?.requestLimit ?? null,
      minuteTokensLeft: row?.minuteTokensLeft ?? null,
      lastUsedAt: row?.lastUsedAt ?? null,
    }
  })

  // The average comes from rows this app counted itself. A row a refusal
  // overwrote holds Groq's rolling total, which includes tokens from before
  // the row existed, so dividing it by today's questions overstates a question.
  const counted = rows.filter((row) => row.tokenLimit === null)
  const questions = counted.reduce((n, row) => n + row.questions, 0)
  const tokens = counted.reduce((n, row) => n + row.tokens, 0)
  const perQuestion = questions >= 3 ? Math.max(500, tokens / questions) : DEFAULT_TOKENS_PER_QUESTION

  const restingForDay = (m: ModelUsage) => m.coolUntil !== null && m.coolUntil.getTime() - now > DAY_REST_MS
  // A model with no requests left is done for the day whatever the token count says.
  const tokensLeft = (m: ModelUsage) => (restingForDay(m) || m.requestsLeft === 0 ? 0 : Math.max(0, m.limit - m.used))
  const questionsLeft = Math.floor(perModel.reduce((n, m) => n + tokensLeft(m), 0) / perQuestion)

  const free = perModel.filter((m) => m.coolUntil === null && m.requestsLeft !== 0)
  if (free.length === 0) {
    const resting = perModel.filter((m) => m.coolUntil !== null)
    const coolUntil = resting.length > 0 ? new Date(Math.min(...resting.map((m) => m.coolUntil!.getTime()))) : null
    return {
      status: coolUntil && coolUntil.getTime() - now <= DAY_REST_MS ? 'busy' : 'out',
      inUse: null,
      coolUntil,
      questionsLeft,
      models: perModel,
    }
  }
  const inUse = free[0].model
  const low = questionsLeft < 5 || (free[0].requestsLeft !== null && free[0].requestsLeft < 20)
  return {
    status: low ? 'low' : inUse === models[0] ? 'ready' : 'backup',
    inUse,
    coolUntil: null,
    questionsLeft,
    models: perModel,
  }
}

/** "openai/gpt-oss-120b" → "gpt-oss-120b". */
export const shortModel = (model: string) => model.split('/').pop() ?? model

/** "12:05" under an hour, "2:03:09" over one. */
export function clock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const sec = String(total % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

/** A time of day in Manila, like "3:07 PM". */
export function manilaTime(date: Date): string {
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' })
}

/** What a person calls each model: the first is the main AI, the rest are backups. */
export function friendlyName(index: number, count: number): string {
  if (index === 0) return 'Main AI'
  return count > 2 ? `Backup AI ${index}` : 'Backup AI'
}

/**
 * One plain line per model for the details view. The bar fills as the day's
 * allowance is USED, the way a fuel gauge empties: "Used up" is a full bar,
 * so the bar and the words always say the same thing.
 */
export type ModelLine = { name: string; model: string; percentUsed: number; note: string; tone: 'ok' | 'high' | 'full' }

export function modelLines(
  usage: { inUse: string | null; models: { model: string; used: number; limit: number; coolUntil: Date | string | null; requestsLeft: number | null; requestLimit: number | null }[] },
  now: number,
): ModelLine[] {
  return usage.models.map((m, i) => {
    const cool = m.coolUntil ? new Date(m.coolUntil) : null
    const resting = cool !== null && cool.getTime() > now
    const outForDay = resting && cool.getTime() - now > DAY_REST_MS
    const byTokens = m.limit > 0 ? Math.min(1, m.used / m.limit) : 1
    const byRequests = m.requestsLeft !== null && m.requestLimit ? 1 - m.requestsLeft / m.requestLimit : 0
    const percentUsed = outForDay || m.requestsLeft === 0 ? 100 : Math.round(100 * Math.max(byTokens, byRequests))
    const note = outForDay
      ? `Used up · back at ${manilaTime(cool)}`
      : resting
        ? `Short break · back in ${clock(cool.getTime() - now)}`
        : `${m.model === usage.inUse ? 'In use' : 'Ready'} · about ${percentUsed}% used today`
    return { name: friendlyName(i, usage.models.length), model: m.model, percentUsed, note, tone: percentUsed >= 100 ? 'full' : percentUsed >= 75 ? 'high' : 'ok' }
  })
}

/** The line under "Dex-E" in the chat header. Dates may arrive as strings from JSON. */
export function statusLine(usage: { status: Status; inUse: string | null; coolUntil: Date | string | null }, now: number): string {
  const until = usage.coolUntil ? new Date(usage.coolUntil) : null
  switch (usage.status) {
    case 'local':
      return "Running on this Mac's AI · no daily limit"
    case 'busy':
      return until ? `Busy · ready again in ${clock(until.getTime() - now)}` : 'Busy · try again in a minute'
    case 'out':
      return until ? `Used up for today · back at ${manilaTime(until)}` : 'Used up for today'
    case 'low':
      return 'Ready · running low today'
    case 'backup':
      return 'Ready · using the backup AI'
    default:
      return 'Ready'
  }
}
