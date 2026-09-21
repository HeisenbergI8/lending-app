import { Button } from '@/components/ui/button'

/**
 * The report itself, on screen, before it is printed.
 *
 * THE FRAME SHOWS THE REAL FILE. It is the same route, the same bytes and the
 * same renderer the Print button uses, asked for with `inline=1` so the browser
 * displays it instead of saving it. A preview built out of HTML would be a
 * drawing of the document; this is the document.
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
  params: URLSearchParams
  title: string
  className?: string
}) {
  const inline = new URLSearchParams(params)
  inline.set('inline', '1')
  const src = `/api/reports?${inline.toString()}`

  return (
    <div className="space-y-2">
      <iframe
        src={src}
        title={`${title} preview`}
        className={`bg-muted ring-border/70 w-full rounded-xl ring-1 ${className}`}
      />
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
