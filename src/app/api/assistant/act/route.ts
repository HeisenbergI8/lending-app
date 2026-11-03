import { runAction } from '@/server/assistant/action-runners.ts'
import { actionSpec, checkProposal, fileRequired, toFormData } from '@/server/assistant/actions.ts'
import { getCurrentUser } from '@/server/auth/guard.ts'

/**
 * Ask Pondex: the Admin tapped Confirm on a card.
 *
 * Only the Admin's own click reaches this route; the model has no tool that
 * calls it. What it does is exactly what the app's form for the same thing
 * does, because it runs that form's server action with the same fields: the
 * same sign-in check, the same validation, the same refusal sentences. The
 * proposal is checked again from scratch, so an edited request gains nothing.
 *
 * Multipart, because some actions carry files (the screenshot of a loan being
 * sent, proof of payment).
 */

/** Proof uploads go to storage before the row is written; give them time. */
export const maxDuration = 60

export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return Response.json({ ok: false, error: 'Please log in again.' }, { status: 401 })

  const form = await request.formData().catch(() => null)
  const spec = actionSpec(String(form?.get('action') ?? ''))
  if (!form || !spec) return Response.json({ ok: false, error: 'Unknown action.' }, { status: 400 })

  let fields: Record<string, unknown> = {}
  let funders: unknown = []
  try {
    fields = JSON.parse(String(form.get('fields') ?? '{}')) as Record<string, unknown>
    funders = JSON.parse(String(form.get('funders') ?? '[]')) as unknown
  } catch {
    return Response.json({ ok: false, error: 'Bad request.' }, { status: 400 })
  }

  const checked = checkProposal(spec, fields, funders)
  if (!checked.ok) return Response.json({ ok: false, error: checked.error })

  const files = form.getAll('proof').filter((f): f is File => f instanceof File && f.size > 0)
  if (fileRequired(spec, checked.fields) && files.length === 0) {
    return Response.json({ ok: false, error: `Attach the ${spec.files!.label.toLowerCase()}.` })
  }

  const result = await runAction(spec, toFormData(checked.fields, checked.funders, spec.files ? files : []))
  console.info('[ask-pondex] action', { action: spec.name, ok: result.error === null })
  return Response.json(result.error === null ? { ok: true } : { ok: false, error: result.error })
}
