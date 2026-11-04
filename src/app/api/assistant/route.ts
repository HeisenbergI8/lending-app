import { ask, type ChatTurn, clip, currentUsage } from '@/server/assistant/chat.ts'
import { getCurrentUser } from '@/server/auth/guard.ts'

/**
 * Dex-E: the chat's endpoint.
 *
 * POST: the browser sends the conversation so far; the answer comes back as
 * JSON, with a card to confirm when the answer is a change. GET: how many
 * questions are left today, and when the AI is free again if it is resting.
 * Who is asking comes from the session cookie, never from the body, so the
 * tools can only ever read the signed-in account's loans.
 */

/** A question can wait out the free plan's per-minute limit, twice. */
export const maxDuration = 60

function isTurn(value: unknown): value is ChatTurn {
  if (!value || typeof value !== 'object') return false
  const turn = value as Record<string, unknown>
  return (turn.role === 'user' || turn.role === 'assistant') && typeof turn.text === 'string'
}

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return Response.json({ error: 'Please log in again.' }, { status: 401 })
  return Response.json(await currentUsage())
}

export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return Response.json({ ok: false, error: 'Please log in again.' }, { status: 401 })

  const body: unknown = await request.json().catch(() => null)
  const turns = (body as { messages?: unknown } | null)?.messages
  if (!Array.isArray(turns) || !turns.every(isTurn) || turns.length === 0) {
    return Response.json({ ok: false, error: 'Bad request.' }, { status: 400 })
  }

  const history = turns.map((t) => ({ role: t.role, text: clip(t.text) }))
  if (history.at(-1)?.role !== 'user') return Response.json({ ok: false, error: 'Bad request.' }, { status: 400 })

  return Response.json(await ask(user.id, history))
}
