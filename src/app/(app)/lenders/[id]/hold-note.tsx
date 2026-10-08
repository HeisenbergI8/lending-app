'use client'

import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react'

/** How long a finger has to stay down before it counts as a hold, not a tap. */
const HOLD_MS = 450
/** Movement that turns a hold into a scroll. */
const SLOP_PX = 10

/**
 * A money-history row whose note can be read in full by holding it.
 *
 * The note on the row stops at two lines. Holding the row — anywhere on it —
 * shows the whole note in a bubble above the row, the way a tooltip shows on
 * hover with a mouse. A quick tap still does what it always did: opens the edit
 * dialog, whose trigger is a layer over the whole row (EditTransaction).
 *
 * The click that follows a hold is swallowed here in the CAPTURE phase, before
 * it reaches that trigger, so lifting the finger does not open the dialog too.
 * The bubble closes on the next tap anywhere, or on scroll.
 *
 * A mouse already has the note's `title` for this, so holding is touch and pen
 * only.
 */
export function HoldNoteRow({ note, className, children }: { note: string | null; className?: string; children: ReactNode }) {
  // Where the bubble goes, worked out from the row when the hold lands. FIXED to
  // the screen, because the list is overflow-hidden (for its rounded corners)
  // and would clip a bubble that stuck out above its first row. Above the row
  // when there is room, below it near the top of the screen.
  const [place, setPlace] = useState<CSSProperties | null>(null)
  const open = place !== null
  const setOpen = (next: boolean) => {
    if (!next) setPlace(null)
  }
  const row = useRef<HTMLLIElement>(null)
  const timer = useRef<number | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const held = useRef(false)

  const cancel = () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
    start.current = null
  }

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    // Next frame, so the pointerup that ended the hold does not close it at once.
    const id = window.setTimeout(() => {
      document.addEventListener('pointerdown', close, { once: true })
      window.addEventListener('scroll', close, { once: true, passive: true })
    }, 0)
    return () => {
      window.clearTimeout(id)
      document.removeEventListener('pointerdown', close)
      window.removeEventListener('scroll', close)
    }
  }, [open])

  return (
    <li
      ref={row}
      className={className}
      // No text selection or iOS callout menu fighting the hold.
      style={note ? { WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none' } : undefined}
      onPointerDown={(event) => {
        if (!note || event.pointerType === 'mouse') return
        held.current = false
        start.current = { x: event.clientX, y: event.clientY }
        timer.current = window.setTimeout(() => {
          held.current = true
          timer.current = null
          const box = row.current?.getBoundingClientRect()
          if (!box) return
          const sides = { left: box.left + 12, right: window.innerWidth - box.right + 12 }
          setPlace(
            box.top > 160
              ? { ...sides, bottom: window.innerHeight - box.top + 4 }
              : { ...sides, top: box.bottom + 4 },
          )
          navigator.vibrate?.(10)
        }, HOLD_MS)
      }}
      onPointerMove={(event) => {
        if (!start.current) return
        if (Math.hypot(event.clientX - start.current.x, event.clientY - start.current.y) > SLOP_PX) cancel()
      }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onContextMenu={(event) => {
        // Android's long-press menu.
        if (note) event.preventDefault()
      }}
      onClickCapture={(event) => {
        if (!held.current) return
        held.current = false
        event.preventDefault()
        event.stopPropagation()
      }}
    >
      {children}
      {open && note ? (
        <div
          role="tooltip"
          style={place ?? undefined}
          className="bg-foreground text-background animate-in fade-in-0 zoom-in-95 fixed z-50 max-h-60 overflow-y-auto rounded-xl px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap shadow-lg break-words select-text"
        >
          {note}
        </div>
      ) : null}
    </li>
  )
}
