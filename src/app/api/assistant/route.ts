import { ask, type ChatTurn } from '@/server/assistant/chat.ts'
import { getCurrentUser } from '@/server/auth/guard.ts'

/**
 * Ask Pondex: the chat's one endpoint.
 *
 * The browser sends the conversation so far; the answer comes back as JSON.
 * Who is asking comes from the session cookie, never from the body, so the
 * tools can only ever read the signed-in account's loans.
 */

/** A question can wait out the free plan's per-minute limit, twice. */
export const maxDuration = 60

/** Longest question accepted. A real one is a sentence; this stops pasted essays costing tokens. */
const MAX_CHARS = 600

function isTurn(value: unknown): value is ChatTurn {
  if (!value || typeof value !== 'object') return false
  const turn = value as Record<string, unknown>
  return (turn.role === 'user' || turn.role === 'assistant') && typeof turn.text === 'string'
}

export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return Response.json({ ok: false, error: 'Please log in again.' }, { status: 401 })

  const body: unknown = await request.json().catch(() => null)
  const turns = (body as { messages?: unknown } | null)?.messages
  if (!Array.isArray(turns) || !turns.every(isTurn) || turns.length === 0) {
    return Response.json({ ok: false, error: 'Bad request.' }, { status: 400 })
  }

  const history = turns.map((t) => ({ role: t.role, text: t.text.slice(0, MAX_CHARS) }))
  if (history.at(-1)?.role !== 'user') return Response.json({ ok: false, error: 'Bad request.' }, { status: 400 })

  return Response.json(await ask(user.id, history))
}
