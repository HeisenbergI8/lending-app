'use client'

import { type FormEvent, type ReactNode, useState } from 'react'
import { Info, TriangleAlert } from 'lucide-react'

import { showToast } from '@/components/toast.tsx'
import { Button } from '@/components/ui/button'

/**
 * A plain GET form whose file downloads stay on this page.
 *
 * WHY. On an iPhone, following a link to a Word, Excel or PDF file replaces the
 * page with a preview of it — and in the installed app there is no back button,
 * so the Admin was left stranded on a grey "DOCX" screen. Here the file is
 * fetched in the background instead and handed to the phone's share sheet
 * (Save to Files, Messenger, Mail…), which closes back onto Reports. A computer
 * gets an ordinary download.
 *
 * ONLY FILE REQUESTS ARE CAUGHT. A submit going anywhere but `/api/` — the
 * Preview button, which reloads this page — goes through untouched. And with
 * JavaScript off the form is still a plain GET form, so every button still
 * works, just the old way.
 *
 * THE SECOND TAP. iOS lets a page open the share sheet only straight after a
 * tap, and a slow file can outlast that window. When it does, the file is kept
 * and a "Save or share" button appears: tapping it is a fresh tap, and the
 * sheet opens at once.
 */

type Ready = { file: File } | null

/**
 * How long a result stays up. The toast sits mid-screen, so it is brief: long
 * enough to read. A problem has no time limit and stays until tapped.
 *
 * Every outcome is a toast because a download that finishes silently reads as
 * one that never happened — on a phone especially, where the file went to a
 * sheet that has already closed.
 */
const SHOWN_FOR_MS = 3_200

const saved = (file: File) => showToast({ tone: 'done', title: 'Saved', detail: file.name }, SHOWN_FOR_MS)

function fileNameFrom(disposition: string | null, fallback: string): string {
  if (!disposition) return fallback
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)
  if (encoded) return decodeURIComponent(encoded[1])
  const plain = /filename="([^"]+)"/i.exec(disposition)
  return plain ? plain[1] : fallback
}

/** Touch phones and tablets, where a share sheet beats a download. */
function prefersShareSheet(file: File): boolean {
  return (
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [file] }) &&
    window.matchMedia('(pointer: coarse)').matches
  )
}

function saveThroughBrowser(file: File) {
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = url
  // Accents folded away ("Peña" -> "Pena") for this path only. Some Chromium
  // builds silently rename a download with any non-ASCII letter to "download",
  // which is exactly the anonymous file this name exists to prevent. The share
  // sheet keeps the real spelling.
  link.download = file.name.normalize('NFKD').replace(/[^\x20-\x7E]/g, '')
  document.body.append(link)
  link.click()
  link.remove()
  // Long enough for the browser to have started reading it.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export function DownloadForm({
  action,
  className,
  children,
}: {
  action: string
  className?: string
  children: ReactNode
}) {
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState<Ready>(null)

  async function share(file: File): Promise<void> {
    try {
      await navigator.share({ files: [file] })
      setReady(null)
      // The sheet does not say which of its options was picked — Save to Files
      // and Messenger look the same from here — so "done", not "saved".
      showToast({ tone: 'done', title: 'Done', detail: file.name }, SHOWN_FOR_MS)
    } catch (error) {
      const name = error instanceof DOMException ? error.name : ''
      // Closing the sheet without picking anything is a choice, not a failure.
      if (name === 'AbortError') {
        setReady(null)
        showToast(
          {
            tone: 'plain',
            title: 'Cancelled',
            detail: 'Nothing was saved.',
            icon: <Info className="text-muted-foreground size-8" aria-hidden />,
          },
          SHOWN_FOR_MS,
        )
      } else if (name === 'NotAllowedError') {
        setReady({ file })
      } else {
        saveThroughBrowser(file)
        setReady(null)
        saved(file)
      }
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    const form = event.currentTarget
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null
    const target = submitter?.getAttribute('formaction') ?? form.getAttribute('action') ?? ''
    if (!target.startsWith('/api/')) return

    event.preventDefault()
    if (busy) return

    const data = new FormData(form)
    if (submitter?.name) data.set(submitter.name, submitter.value)
    const query = new URLSearchParams(
      [...data.entries()].map(([key, value]) => [key, String(value)] as [string, string]),
    )
    const url = `${target}?${query.toString()}`

    setBusy(true)
    setReady(null)
    try {
      const response = await fetch(url, { credentials: 'same-origin' })
      // An error page, or a login page after a lapsed session: show it the old
      // way rather than saving it as if it were the file.
      const type = response.headers.get('Content-Type') ?? ''
      if (!response.ok || type.startsWith('text/')) {
        // A full load on purpose: this is an API response, not a page the
        // router knows, so it is given as an absolute address.
        window.location.assign(new URL(url, window.location.origin).href)
        return
      }

      const blob = await response.blob()
      const file = new File([blob], fileNameFrom(response.headers.get('Content-Disposition'), 'report'), {
        type: blob.type,
      })

      if (prefersShareSheet(file)) {
        await share(file)
      } else {
        saveThroughBrowser(file)
        saved(file)
      }
    } catch {
      showToast({
        tone: 'plain',
        title: 'The file could not be made',
        detail: 'Check the connection and try again.',
        icon: <TriangleAlert className="text-muted-foreground size-8" aria-hidden />,
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form method="get" action={action} onSubmit={onSubmit} className={className} aria-busy={busy}>
      {children}

      {ready ? (
        <div className="flex basis-full flex-wrap items-center gap-2">
          <Button type="button" onClick={() => share(ready.file)}>
            Save or share the file
          </Button>
        </div>
      ) : null}

      {/* "Preparing" stays beside the button, where the tap was. The outcome
          is a toast, because by then the Admin may be looking at the share
          sheet rather than at this card. */}
      <p className="text-muted-foreground basis-full text-xs empty:hidden" aria-live="polite">
        {busy ? 'Preparing the file…' : null}
      </p>
    </form>
  )
}
