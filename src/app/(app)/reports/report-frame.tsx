'use client'

import { useEffect, useRef, useState } from 'react'

import { LoadingOverlay } from '@/components/brand-loader.tsx'
import { Button } from '@/components/ui/button'

/**
 * The report itself, on screen, before it is printed.
 *
 * THE FRAME SHOWS THE REAL FILE. It is the same route, the same bytes and the
 * same renderer the Print button uses, asked for with `inline=1` so the browser
 * displays it instead of saving it. A preview built out of HTML would be a
 * drawing of the document; this is the document.
 *
 * Which is also why this is the app's longest wait: the server queries the whole
 * range and lays out a PDF before a single byte comes back, and an empty grey
 * rectangle for several seconds reads as broken. The loader sits over the frame
 * until the file arrives, frosting it rather than hiding it, so the shape of
 * what is coming is visible the whole time.
 *
 * It is a client component for that one reason — the iframe's load event. The
 * query string therefore arrives as a STRING: a URLSearchParams cannot cross
 * from a server component to a client one.
 *
 * Not every browser will render a PDF in a frame — iOS Safari in particular
 * often will not — so the link underneath is not a nicety. It is the fallback
 * for the case where the frame comes up blank, and it opens the very same URL.
 */
export function ReportFrame({
  params,
  title,
  className = 'h-[60vh] min-h-96',
}: {
  /** The report's query string, already built by the page that asked for it. */
  params: string
  title: string
  className?: string
}) {
  const inline = new URLSearchParams(params)
  inline.set('inline', '1')
  const src = `/api/reports?${inline.toString()}`

  // The src that finished loading, rather than a plain boolean. Changing the
  // dates swaps the src, and a boolean would leave the old "ready" standing
  // while the new file is still being built.
  const [loaded, setLoaded] = useState<string | null>(null)
  const frame = useRef<HTMLIFrameElement>(null)

  /**
   * THIS ASKS THE FRAME; IT DOES NOT WAIT TO BE TOLD. Two bugs got it here and
   * both were the same mistake — treating a one-shot event as the truth.
   *
   * `onLoad` fires once. The src is in the server-rendered HTML, so the browser
   * starts fetching the PDF while the page is still parsing, and on a slow
   * connection the file can finish before React hydrates and attaches the
   * listener. The event then lands with nobody listening. Worse, the Preview
   * form's own path issues three requests in the first ten milliseconds — two
   * aborted, one kept — so even a listener that IS attached can end up on an
   * element that never sees the load that mattered. Both times the result was
   * the same: a frosted overlay sitting over a finished report, for ever,
   * exactly on the slow-phone path this loader was built for.
   *
   * An interval has neither failure. It asks the element that is in the DOM
   * right now, every quarter second, so a missed event, a replaced element and
   * a load that beat hydration all resolve on the next tick. `onLoad` stays as
   * an accelerator for the common case, not as the thing being relied on.
   *
   * The ceiling is the last resort, for a browser that hands the PDF to a
   * plugin document whose readyState cannot be read at all. An overlay lifted
   * early shows a frame that is visibly still blank, and the line underneath
   * already says what to do about a blank frame. An overlay that never lifts
   * hides a report that is sitting right there.
   */
  useEffect(() => {
    // Settled. `loaded` is in the deps for this line: it is what tears the
    // interval down, so a phone is not woken every quarter second behind a
    // report nobody is waiting for any more.
    if (loaded === src) return

    const finished = () => {
      try {
        return frame.current?.contentWindow?.document.readyState === 'complete'
      } catch {
        // A plugin document this page is not allowed to read. The ceiling has it.
        return false
      }
    }

    if (finished()) {
      setLoaded(src)
      return
    }

    const poll = setInterval(() => {
      if (finished()) setLoaded(src)
    }, 250)
    const ceiling = setTimeout(() => setLoaded(src), 15_000)

    return () => {
      clearInterval(poll)
      clearTimeout(ceiling)
    }
  }, [src, loaded])

  return (
    <div className="space-y-2">
      <div className={`relative rounded-xl ${className}`}>
        <iframe
          ref={frame}
          src={src}
          title={`${title} preview`}
          onLoad={() => setLoaded(src)}
          className="bg-muted ring-border/70 size-full rounded-xl ring-1"
        />
        {loaded === src ? null : <LoadingOverlay label="Building the report…" />}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <a href={src} target="_blank" rel="noopener noreferrer">
            Open in a new tab
          </a>
        </Button>
        <p className="text-muted-foreground text-xs">
          If the preview is blank, this phone cannot show a PDF in the page. Open it in a tab.
        </p>
      </div>
    </div>
  )
}
