'use client'

import { type ReactNode, useEffect, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { Check } from 'lucide-react'

import { cn } from '@/lib/utils'

/** Nothing to listen to: whether we are in a browser never changes. */
const noSubscription = () => () => {}

/** How long the leave animation runs before the toast is actually removed. */
const LEAVE_MS = 180

export type ToastMessage = {
  /**
   * `done` is the celebration: the Pondex mark builds itself out of a mint disc
   * and a tick pops on. `plain` is for everything that is not a success — a
   * cancel, a problem — and gets only its icon, because a sheet that was closed
   * on purpose is not something to celebrate.
   */
  tone: 'done' | 'plain'
  title: string
  detail?: string
  icon?: ReactNode
}

/**
 * ONE TOAST AT A TIME. Every card on Reports can finish a download, and when
 * each owned its own toast, a second download while the first was still up
 * stacked two cards in the middle of the screen. So the message lives here, in
 * one small store, and a single <ToastHost /> draws it: a new message simply
 * replaces the old one.
 */
type Shown = { message: ToastMessage; closeAfterMs?: number } | null

let shown: Shown = null
const listeners = new Set<() => void>()

function publish(next: Shown) {
  shown = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Show a message. `closeAfterMs` left out keeps it up until tapped — for a
 * problem the Admin must read.
 */
export function showToast(message: ToastMessage, closeAfterMs?: number) {
  publish({ message, closeAfterMs })
}

/**
 * The toast itself: a card in the middle of the screen that goes away on its own.
 *
 * For news that arrives after the Admin has looked away — a download that
 * finished while the phone's share sheet was up is the case it was made for.
 * The middle, not an edge, because that is where the eyes are when the sheet
 * closes. It never blocks the page: only the card itself takes taps, and a tap
 * dismisses it.
 *
 * The animation, and why it is mint rather than the "paid" green, are written
 * up beside the keyframes in globals.css ("THE DONE TOAST").
 *
 * Mount once per screen that shows toasts. Rendered into <body> so no
 * transformed ancestor can pin it inside a card.
 */
export function ToastHost() {
  // False while rendering on the server, true in the browser: there is no
  // <body> to portal into until then.
  const inBrowser = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  )
  const current = useSyncExternalStore(
    subscribe,
    () => shown,
    () => null,
  )
  // Which message is on its way out. Compared by identity, so a new message
  // arriving mid-exit starts fresh rather than inheriting the old one's fade.
  const [leaving, setLeaving] = useState<ToastMessage | null>(null)

  useEffect(() => {
    if (!current?.closeAfterMs) return
    const { message } = current
    let removal: ReturnType<typeof setTimeout> | undefined
    const close = setTimeout(() => {
      setLeaving(message)
      removal = setTimeout(() => {
        // Only if nothing newer has replaced it in the meantime.
        if (shown?.message === message) publish(null)
      }, LEAVE_MS)
    }, current.closeAfterMs)
    return () => {
      clearTimeout(close)
      clearTimeout(removal)
    }
  }, [current])

  if (!inBrowser || !current) return null
  const { message } = current

  const dismiss = () => {
    setLeaving(message)
    setTimeout(() => {
      if (shown?.message === message) publish(null)
    }, LEAVE_MS)
  }

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-6"
    >
      <button
        type="button"
        onClick={dismiss}
        // Keyed on the message itself, so a second download replays the
        // entrance instead of silently swapping the text in a card that has
        // already arrived.
        key={keyOf(message)}
        className={cn(
          'bg-card text-card-foreground ring-border/70 shadow-float pointer-events-auto flex w-full max-w-xs flex-col items-center gap-3 rounded-3xl px-6 py-6 text-center ring-1',
          leaving === message ? 'animate-toast-leave' : 'animate-toast-pop',
        )}
      >
        {message.tone === 'done' ? <BuildingMark /> : message.icon}
        <span className="text-base font-semibold tracking-tight">{message.title}</span>
        {message.detail ? (
          <span className="text-muted-foreground -mt-2 text-sm break-words">{message.detail}</span>
        ) : null}
        <span className="sr-only">Tap to dismiss</span>
      </button>
    </div>,
    document.body,
  )
}

/** A fresh key per message object, so the same text twice still replays. */
const keys = new WeakMap<ToastMessage, number>()
let nextKey = 0
function keyOf(message: ToastMessage): number {
  let key = keys.get(message)
  if (key === undefined) {
    key = nextKey++
    keys.set(message, key)
  }
  return key
}

/**
 * The Pondex mark assembling itself on a mint disc, with a tick popping on.
 *
 * Same geometry as PondexMark (and src/app/icon.svg). Drawn here rather than
 * through PondexMark because these parts need a one-shot entrance with their
 * own delays, and the loader's ripple must stay exactly as it is.
 *
 * The mark is in the card colour: white on the deep light-theme mint, near
 * black on the paler dark-theme one, so it reads on both.
 */
function BuildingMark() {
  return (
    <span className="relative flex size-16 items-center justify-center" aria-hidden>
      <span className="animate-toast-ring absolute inset-0 rounded-full bg-[var(--chip-mint)]" />
      <span className="text-card relative flex size-16 items-center justify-center rounded-full bg-[var(--chip-mint)]">
        <svg viewBox="0 0 100 100" className="size-7" fill="currentColor">
          <rect x="0" y="0" width="39" height="100" className="animate-toast-part pondex-from-bottom" style={{ animationDelay: '0.1s' }} />
          <rect x="45" y="0" width="55" height="30" className="animate-toast-part pondex-from-top" style={{ animationDelay: '0.22s' }} />
          <rect x="45" y="36" width="55" height="64" className="animate-toast-part pondex-from-bottom" style={{ animationDelay: '0.3s' }} />
        </svg>
      </span>
      <span className="bg-card animate-toast-tick absolute -right-1 -bottom-1 flex size-7 items-center justify-center rounded-full ring-2 ring-[var(--chip-mint)]">
        <Check className="size-4 text-[var(--chip-mint)]" strokeWidth={3} />
      </span>
    </span>
  )
}
