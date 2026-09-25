'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'

/**
 * The screen's name in the top bar, on phones, once the heading has scrolled
 * away.
 *
 * WHY THE BAR IS EMPTY UNTIL THEN. It used to carry the mark and the word
 * "Pondex", which told the admin something she already knew — she tapped the
 * icon to get here. A bar that repeats the app's name spends a row of a phone
 * screen saying nothing, and then the page spends a second row on the heading
 * that says where she actually is. This is the platform answer to that: the big
 * heading stays where it is, and the bar picks it up only when it is gone.
 *
 * IT READS THE PAGE'S OWN <h1> rather than taking a title prop. Every screen
 * already writes its name once, in the heading; a second copy passed down
 * through the layout is a second thing to keep in step, and the two drift the
 * first time someone renames a page. Reading the DOM means the bar cannot say
 * anything the screen does not.
 */
export function CollapsedTitle() {
  const pathname = usePathname()
  // The pathname travels WITH the title rather than being cleared on
  // navigation: clearing it would mean a setState in the effect body, which
  // costs a second render of the whole bar on every page change. Holding both
  // lets a title left over from the previous screen simply not match, so it
  // stops rendering without anything having to reset it.
  const [shown, setShown] = useState<{ path: string; text: string } | null>(null)

  useEffect(() => {
    let observer: IntersectionObserver | null = null
    let frame = 0
    let tries = 0

    const attach = () => {
      const heading = document.querySelector('main h1')

      // The pathname changes before the new page's markup arrives, so on the
      // first frames after a navigation there is no heading to watch yet. Keep
      // looking for about a second; a screen that genuinely has no h1 just
      // leaves the bar empty, which is the old behaviour and harms nothing.
      if (!heading) {
        if (tries++ < 60) frame = requestAnimationFrame(attach)
        return
      }

      const text = heading.textContent?.trim() ?? ''
      if (!text) return

      observer = new IntersectionObserver(([entry]) => setShown(entry.isIntersecting ? null : { path: pathname, text }), {
        // The bar is sticky and paints OVER the page, so by the time the heading
        // reaches the top of the viewport it has already been hidden by it.
        // Pulling the root's top edge down by the bar's own height is what makes
        // the swap land as the heading disappears rather than a beat late.
        rootMargin: '-56px 0px 0px 0px',
        threshold: 0,
      })
      observer.observe(heading)
    }

    attach()

    return () => {
      cancelAnimationFrame(frame)
      observer?.disconnect()
    }
  }, [pathname])

  if (!shown || shown.path !== pathname) return null

  return (
    <span className="animate-in fade-in slide-in-from-bottom-1 min-w-0 truncate text-[0.95rem] font-semibold tracking-tight duration-200 md:hidden">
      {shown.text}
    </span>
  )
}
