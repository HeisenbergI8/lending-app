'use client'

import { type ReactNode, useEffect, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'

/** Nothing to listen to: whether we are in a browser never changes. */
const noSubscription = () => () => {}

/**
 * A short message that floats over the page and goes away on its own.
 *
 * For news that arrives after the Admin has looked away — a download that
 * finished while the phone's share sheet was up is the case it was made for.
 * A line of text beside the button is easy to miss there; this is not.
 *
 * INVERTED, NOT COLOURED. It is the foreground colour on the background one,
 * which stands out in both themes without borrowing a loan-state colour.
 *
 * Sits above the phone's bottom tab bar, whose height the app layout already
 * reserves as 5.5rem plus the safe area; on a wider screen, bottom right.
 * Rendered into <body> so no transformed ancestor can pin it inside a card.
 *
 * Tap to dismiss. `null` hides it.
 */
export function Toast({
  icon,
  children,
  onClose,
  closeAfterMs,
}: {
  icon?: ReactNode
  children: ReactNode | null
  onClose: () => void
  /** Leave out to keep it up until tapped — for a problem the Admin must read. */
  closeAfterMs?: number
}) {
  // False while rendering on the server, true in the browser: there is no
  // <body> to portal into until then.
  const inBrowser = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  )

  useEffect(() => {
    if (children === null || !closeAfterMs) return
    const timer = setTimeout(onClose, closeAfterMs)
    return () => clearTimeout(timer)
  }, [children, closeAfterMs, onClose])

  if (!inBrowser) return null

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-4 z-50 flex justify-center bottom-[calc(5.5rem+env(safe-area-inset-bottom,0px))] md:inset-x-auto md:right-6 md:bottom-6"
    >
      {children !== null ? (
        <button
          type="button"
          onClick={onClose}
          className="bg-foreground text-background shadow-float animate-in fade-in slide-in-from-bottom-2 pointer-events-auto flex max-w-md items-start gap-2 rounded-xl px-4 py-3 text-left text-sm font-medium duration-200"
        >
          {icon}
          <span className="min-w-0 break-words">{children}</span>
          <span className="sr-only">Tap to dismiss</span>
        </button>
      ) : null}
    </div>,
    document.body,
  )
}
