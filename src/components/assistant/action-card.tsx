'use client'

import { useState } from 'react'
import { Check, Loader2, Paperclip, X } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * A change Dex-E has proposed, waiting for the Admin.
 *
 * Nothing has been saved when this appears. Confirm posts the proposal to
 * /api/assistant/act, which runs the app's own server action for it; the
 * result shown here is that action's answer, not the AI's claim. A refusal
 * ("Fidel only has ₱6,500.00 floating") stays on the card so it can be fixed
 * in the chat and proposed again.
 */

export type ProposalView = {
  action: string
  title: string
  lines: { label: string; value: string }[]
  fields: Record<string, string>
  funders: { lenderId: string; amount: string }[]
  files: { required: boolean; label: string } | null
}

/** `replaced`: a newer card came after this one, so this one can no longer be confirmed. */
export type CardStatus = 'ready' | 'saving' | 'done' | 'failed' | 'cancelled' | 'replaced'

export function ActionCard({
  proposal,
  status,
  error,
  onStatus,
}: {
  proposal: ProposalView
  status: CardStatus
  error: string | null
  onStatus: (status: CardStatus, error: string | null) => void
}) {
  const [files, setFiles] = useState<File[]>([])
  const open = status === 'ready' || status === 'failed'
  const needsFile = proposal.files?.required === true && files.length === 0

  async function confirm() {
    onStatus('saving', null)
    const body = new FormData()
    body.set('action', proposal.action)
    body.set('fields', JSON.stringify(proposal.fields))
    body.set('funders', JSON.stringify(proposal.funders))
    for (const file of files) body.append('proof', file)
    try {
      const response = await fetch('/api/assistant/act', { method: 'POST', body })
      const data = (await response.json()) as { ok: boolean; error?: string }
      onStatus(data.ok ? 'done' : 'failed', data.ok ? null : (data.error ?? 'That did not save.'))
    } catch {
      onStatus('failed', 'Could not reach Pondex. Nothing was saved.')
    }
  }

  return (
    <div
      className={cn(
        'animate-ask-rise overflow-hidden rounded-2xl border',
        status === 'done'
          ? 'border-emerald-500/40'
          : status === 'cancelled' || status === 'replaced'
            ? 'border-border opacity-60'
            : 'border-brand/40',
      )}
    >
      <div className="bg-muted/40 flex items-center justify-between gap-3 px-3.5 py-2.5">
        <p className="text-sm font-semibold">{proposal.title}</p>
        <span
          className={cn(
            'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium',
            status === 'done' && 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
            (status === 'cancelled' || status === 'replaced') && 'bg-muted text-muted-foreground',
            (status === 'ready' || status === 'saving') && 'bg-brand/10 text-brand',
            status === 'failed' && 'bg-destructive/10 text-destructive',
          )}
        >
          {status === 'done'
            ? 'Saved'
            : status === 'cancelled'
              ? 'Cancelled'
              : status === 'replaced'
                ? 'Replaced by a newer card'
                : status === 'failed'
                  ? 'Not saved'
                  : 'Not saved yet'}
        </span>
      </div>

      <dl className="divide-border/60 divide-y">
        {proposal.lines.map((line) => (
          <div key={line.label} className="flex justify-between gap-5 px-3.5 py-2 text-sm">
            <dt className="text-muted-foreground">{line.label}</dt>
            <dd className="text-right font-medium tabular-nums">{line.value}</dd>
          </div>
        ))}
      </dl>

      {open && proposal.files && (
        // The file is the next step when Confirm needs it, so the row says so and has its own button.
        <label
          className={cn(
            'border-border/60 flex min-h-11 cursor-pointer items-center gap-2.5 border-t px-3.5 py-2.5 text-sm focus-within:ring-2 focus-within:ring-brand/40',
            needsFile ? 'bg-brand-bg hover:bg-brand-bg/70' : 'hover:bg-accent',
          )}
        >
          <Paperclip className={cn('size-4 shrink-0', needsFile ? 'text-brand' : 'text-muted-foreground')} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className={cn(files.length > 0 ? 'truncate' : 'leading-snug', files.length === 0 && !needsFile && 'text-muted-foreground', needsFile && 'text-foreground font-medium')}>
              {files.length > 0 ? files.map((f) => f.name).join(', ') : proposal.files.label}
            </span>
            {needsFile && <span className="text-muted-foreground text-xs">Needed to confirm</span>}
          </span>
          <span
            aria-hidden
            className={cn(
              'shrink-0 rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap',
              files.length > 0 ? 'text-muted-foreground border-border border' : 'bg-brand text-brand-foreground',
            )}
          >
            {files.length > 0 ? 'Change' : 'Choose file'}
          </span>
          <input
            type="file"
            accept="image/*,application/pdf"
            multiple
            className="sr-only"
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          />
        </label>
      )}

      {error && <p className="bg-destructive/5 text-destructive border-t px-3.5 py-2.5 text-sm">{error}</p>}

      {(open || status === 'saving') && (
        <div className="border-border/60 flex gap-2 border-t p-2.5">
          <button
            type="button"
            onClick={() => onStatus('cancelled', null)}
            disabled={status === 'saving'}
            className="border-border hover:bg-accent flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl border text-sm disabled:cursor-default disabled:opacity-50"
          >
            <X className="size-4" /> Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={status === 'saving' || needsFile}
            // Waiting for a file, Confirm is plain grey (the file row above says why); not a faded blue that looks broken.
            aria-label={needsFile ? 'Confirm (attach the file first)' : undefined}
            className={cn(
              'flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl text-sm font-medium whitespace-nowrap disabled:cursor-default',
              needsFile ? 'bg-muted text-muted-foreground' : 'bg-brand text-brand-foreground hover:bg-brand-strong disabled:opacity-50',
            )}
          >
            {status === 'saving' ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            {status === 'saving' ? 'Saving…' : 'Confirm'}
          </button>
        </div>
      )}
    </div>
  )
}
