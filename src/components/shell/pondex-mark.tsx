import { cn } from '@/lib/utils'

/**
 * The Pondex mark: a solid bar and a split block, drawn in `currentColor` so the
 * one shape serves the dark sidebar, the phone top bar and the login card
 * without a second copy per surface.
 *
 * Inline rather than an <img> to public/pondex-mark.svg, because every place it
 * appears sits inside a coloured tile and needs the mark to take the tile's
 * foreground colour. An <img> cannot be recoloured by CSS. It is also what lets
 * `animated` reach the three rects individually — an <img> is one opaque box,
 * and the loader's whole point is that the mark's own parts move.
 *
 * Geometry is the same 100×100 grid as src/app/icon.svg — if one changes, the
 * other has to, or the tab icon stops matching the app it opens.
 */
export function PondexMark({
  className,
  animated = false,
}: {
  className?: string
  /**
   * Run the loading ripple through the mark's three parts. Only the loader sets
   * this — the sidebar, top bar and login card all want the shape sitting still.
   */
  animated?: boolean
}) {
  // Each part falls away from the middle of the mark and springs back, a beat
  // after the one to its left. Keyframes and the reason for them: globals.css.
  const part = animated ? 'animate-pondex-part' : undefined

  return (
    <svg viewBox="0 0 100 100" className={className} fill="currentColor" aria-hidden>
      <rect x="0" y="0" width="39" height="100" className={cn(part, 'pondex-from-bottom')} />
      <rect
        x="45"
        y="0"
        width="55"
        height="30"
        className={cn(part, 'pondex-from-top', 'pondex-delay-1')}
      />
      <rect
        x="45"
        y="36"
        width="55"
        height="64"
        className={cn(part, 'pondex-from-bottom', 'pondex-delay-2')}
      />
    </svg>
  )
}
