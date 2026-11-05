'use client'

import { useEffect, useState } from 'react'

/**
 * Whether the floating Dex-E button should step aside, so it never sits on top
 * of what is under it (the loans list's Next button was the case that found this).
 *
 * - Scrolling DOWN tucks it away: the Admin is reading, not asking.
 * - Scrolling UP brings it back, and so does the top of the page.
 * - The bottom of the page keeps it tucked: that is where the last row, a pager
 *   or a Save button lives, and nothing below it could be scrolled into view.
 *
 * It does NOT come back on its own when scrolling stops: it would land on
 * whatever was under it again. Extra padding was rejected for the same reason
 * (2026-11-05): it fixes one page and shifts the overlap to another.
 */
const SETTLE = 6 // px of scroll ignored, so a finger's wobble does not flicker it
const NEAR_BOTTOM = 24

export function useTucked(): boolean {
  const [tucked, setTucked] = useState(false)

  useEffect(() => {
    let last = window.scrollY
    let frame = 0

    const check = () => {
      frame = 0
      const y = window.scrollY
      const atTop = y <= 8
      const atBottom = y > 0 && window.innerHeight + y >= document.documentElement.scrollHeight - NEAR_BOTTOM
      if (atTop) setTucked(false)
      else if (atBottom) setTucked(true)
      else if (y - last > SETTLE) setTucked(true)
      else if (last - y > SETTLE) setTucked(false)
      else return // too small a move to count: keep `last` so slow scrolls still add up
      last = y
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(check)
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  return tucked
}
