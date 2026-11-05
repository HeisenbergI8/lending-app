import { ask, type ChatTurn, clip, currentUsage } from '@/server/assistant/chat.ts'
import { getCurrentUser } from '@/server/auth/guard.ts'

/**
 * Dex-E: the chat's endpoint.
 *
 * POST: the browser sends the conversation so far; the answer comes back as
 * JSON, with a card to confirm when the answer is a change. With stream: true,
 * each lookup comes first as its own line, so the chat can show the steps live. GET: how many
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

  // Server-only test mode: the AI is never called. Demo account only, so the live account always gets the full chat.
  const serverOnly = (body as { serverOnly?: unknown }).serverOnly === true
  // Translator test mode: the server, its memory and the small translator, never the full AI.
  const translateTest = (body as { translateTest?: unknown }).translateTest === true
  if ((serverOnly || translateTest) && !user.isDemo) return Response.json({ ok: false, error: 'Test mode is for the demo account only.' }, { status: 403 })
  if ((body as { stream?: unknown }).stream !== true) return Response.json(await ask(user.id, history, undefined, { serverOnly, translateTest }))

  // Streamed: one JSON line per step as Dex-E works ("Looking for Angel…",
  // "Found Angel Dela Cruz"), then a last line with the answer.
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (line: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`))
      try {
        send({ type: 'result', result: await ask(user.id, history, (step) => send({ type: 'step', step }), { serverOnly, translateTest }) })
      } catch {
        send({ type: 'result', result: { ok: false, error: 'Dex-E could not answer just now. Try again.', usage: null } })
      }
      controller.close()
    },
  })
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' } })
}
