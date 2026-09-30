'use client'

import { type PointerEvent, type ReactNode, useEffect, useRef, useState } from 'react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { X } from 'lucide-react'

/**
 * A borrower's photo, full screen.
 *
 * THE WHOLE PICTURE, NOT THE CIRCLE. The circles everywhere else are a small
 * square cropped from the middle; this shows the photo as it was taken, as
 * large as the screen allows, on a dark ground so the face is the only thing
 * lit. It opens with a short zoom from the middle, the way a photo opens in the
 * iPhone's own apps.
 *
 * INSTANT, THEN SHARP. The small square is already on screen, so it is drawn at
 * once, blurred, underneath; the full picture fades in over it when it has
 * loaded. No spinner, no blank frame.
 *
 * FOUR WAYS OUT, because a viewer is somewhere people leave by reflex: the X in
 * the corner, a tap anywhere off the picture, Escape, and — on a phone — a
 * swipe down, which drags the picture and fades the dark behind it, and closes
 * past a short distance or springs back short of it.
 *
 * Radix's dialog underneath, for the focus trap, Escape and the scroll lock.
 */

/** How far a swipe down has to travel before letting go closes the viewer. */
const CLOSE_AFTER_PX = 110

export function PhotoViewer({
  name,
  square,
  full,
  children,
}: {
  name: string
  /** The small square the page already shows: drawn at once as a placeholder. */
  square: string
  /** The whole picture, or null for a photo saved before there was one. */
  full: string | null
  /** The trigger: the large circle on the borrower's page. */
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  // The full picture would not load (a link that expired while the page sat
  // open, say): show the square instead of blurring forever.
  const [broken, setBroken] = useState(false)
  const [drag, setDrag] = useState(0)
  // Whether a finger is down: the picture follows it with no easing, and
  // springs back with it.
  const [dragging, setDragging] = useState(false)
  const start = useRef<number | null>(null)

  const onPointerDown = (event: PointerEvent) => {
    // Touch only, and one finger: a mouse has the X and the backdrop, and a
    // second finger is a pinch, which is the browser's to zoom.
    if (event.pointerType === 'mouse' || !event.isPrimary) return
    start.current = event.clientY
    setDragging(true)
  }
  const onPointerMove = (event: PointerEvent) => {
    if (start.current === null || !event.isPrimary) return
    setDrag(Math.max(0, event.clientY - start.current))
  }
  const onPointerUp = () => {
    if (start.current === null) return
    start.current = null
    setDragging(false)
    if (drag > CLOSE_AFTER_PX) setOpen(false)
    setDrag(0)
  }

  const src = full && !broken ? full : square

  // THE PHONE'S STATUS BAR GOES DARK WITH THE VIEWER. Left alone it stays the
  // page's colour, a white strip above a black screen. The app's own colour is
  // put back on close, exactly as it was.
  useEffect(() => {
    if (!open) return
    const metas = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')]
    const before = metas.map((meta) => meta.content)
    metas.forEach((meta) => (meta.content = '#000000'))
    return () => metas.forEach((meta, index) => (meta.content = before[index]))
  }, [open])
  // The dark ground thins as the picture is dragged away, so the page behind
  // shows through before it closes — the cue that letting go will close it.
  const dim = Math.max(0.35, 0.94 - drag / 400)

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        setDrag(0)
        // Every opening starts from the placeholder again, so a picture that
        // has to be fetched anew never leaves a blank dark screen.
        if (next) {
          setLoaded(false)
          setBroken(false)
        }
      }}
    >
      <DialogPrimitive.Trigger asChild>{children}</DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 fixed inset-0 z-50 backdrop-blur-md duration-200"
          style={{ backgroundColor: `rgb(0 0 0 / ${dim})` }}
        />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="data-open:animate-in data-open:fade-in-0 data-open:zoom-in-90 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 fixed inset-0 z-50 flex flex-col duration-200 ease-out outline-none"
          // A tap on the dark, not on the picture, closes it.
          onClick={(event) => {
            if (event.target === event.currentTarget) setOpen(false)
          }}
        >
          <div
            className="flex items-center justify-between gap-3 px-4 pt-[max(env(safe-area-inset-top),0.75rem)] pb-2 text-white"
            onClick={(event) => {
              if (event.target === event.currentTarget) setOpen(false)
            }}
          >
            <DialogPrimitive.Title className="min-w-0 truncate text-base font-semibold tracking-tight">
              {name}
            </DialogPrimitive.Title>
            {/* FROSTED GLASS, the way close buttons read on a current iPhone: a
                small translucent disc that blurs what is behind it, a hairline
                edge, a light catch along the top, and a slim X. The grey
                filled circle it replaced looked like a dated web modal. The
                44px tap area is the button; the 36px disc is drawn inside it. */}
            <DialogPrimitive.Close className="group flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full focus-visible:outline-none">
              <span className="flex size-9 items-center justify-center rounded-full bg-white/14 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.35),0_4px_16px_rgb(0_0_0/0.35)] ring-1 ring-white/20 backdrop-blur-xl backdrop-saturate-150 transition-[background-color,scale] duration-200 ease-out ring-inset group-hover:bg-white/22 group-focus-visible:ring-2 group-focus-visible:ring-white/70 group-active:scale-90">
                <X className="size-4" strokeWidth={2.5} aria-hidden />
              </span>
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
          </div>

          <div
            className="flex min-h-0 flex-1 touch-pinch-zoom items-center justify-center p-4 pb-[max(env(safe-area-inset-bottom),1rem)]"
            onClick={(event) => {
              if (event.target === event.currentTarget) setOpen(false)
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <div
              className="relative max-h-full max-w-full"
              style={{
                transform: `translateY(${drag}px) scale(${1 - Math.min(drag, 300) / 1500})`,
                transition: dragging ? 'none' : 'transform 250ms cubic-bezier(0.32,0.72,0,1)',
              }}
            >
              {/* Plain <img>, not next/image: the size is the picture's own, which
                  is not known until it loads, and the link is a short-lived
                  signed one the optimiser could not fetch anyway. */}
              {!loaded ? (
                // The square, blurred, holding the space until the full picture
                // arrives. It is already loaded, so it paints at once.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={square}
                  alt=""
                  aria-hidden
                  className="block size-[min(88vw,calc(100dvh-8rem))] max-h-[32rem] max-w-[32rem] rounded-2xl object-cover blur-md"
                />
              ) : null}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt={`Photo of ${name}`}
                onLoad={() => setLoaded(true)}
                onError={() => (src !== square ? setBroken(true) : setLoaded(true))}
                draggable={false}
                className={
                  loaded
                    ? 'animate-in fade-in-0 relative block max-h-[calc(100dvh-7rem)] w-auto max-w-[min(92vw,56rem)] rounded-2xl object-contain shadow-2xl duration-300 select-none'
                    : 'absolute inset-0 opacity-0'
                }
              />
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
