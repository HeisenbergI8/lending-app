import { PondexMark } from './shell/pondex-mark.tsx'
import { cn } from '@/lib/utils'

/**
 * What the app shows while it is waiting.
 *
 * ONE MARK FOR EVERY WAIT WORTH LOOKING AT. The pulsing mark is the app saying
 * "I heard you and I am working", and it is the same object on a route change,
 * behind a report and over a refreshing list. A different indicator per screen
 * would make each wait feel like a different app.
 *
 * It is NOT what a button uses. A pending Save shows a plain `LoaderCircle`
 * beside its label, because at 16px the mark is an indistinct smudge and the
 * brand is already on screen twice over. The rule is scale, not inconsistency:
 * the mark pulses where the wait owns the area, a bare ring where it does not.
 *
 * Two pieces, because they answer different questions:
 *
 *   LoadingScreen  — there is nothing on screen yet. Route `loading.tsx` files.
 *                    Puts the mark over a skeleton of the screen that is coming.
 *   LoadingOverlay — there IS something on screen and it is about to change.
 *                    Frosts what is behind it, so the old figures are visibly
 *                    stale rather than quietly wrong.
 *
 * Both print a word as well as moving. Under `prefers-reduced-motion` the rule
 * in globals.css freezes every animation here, and the sentence is then the
 * whole of the signal — which is also why neither of these is ever the only
 * thing telling the admin something is happening.
 */

/**
 * The mark itself, and nothing else.
 *
 * It used to be the mark inside a filled tile, inside a turning ring, inside a
 * halo. Three pieces of furniture around a 24px logo — so the animation was
 * happening on the smallest thing in the stack, and the tile was the SAME navy
 * square that already sits in the top bar and the sidebar. The loader looked
 * like the chrome rather than like something happening.
 *
 * Dropping all three doubles the logo without the loader taking any more room,
 * and the ripple through its parts becomes the whole of the event instead of a
 * detail inside a badge. The ring is no loss: it existed to give the eye a
 * second rate of motion, and the three parts already run a sixth of a second
 * apart from each other.
 *
 * One size. The sm and lg variants were never called — every wait in the app is
 * a screen or a panel, and both want the same mark.
 */
function BrandMark({ className }: { className?: string }) {
  return <PondexMark className={cn('text-brand size-12', className)} animated />
}

/**
 * The shape of a screen that has not arrived yet.
 *
 * Deliberately GENERIC: a heading, a lead card, a row of tiles, some rows. Every
 * screen in the app opens on roughly that, so one set of blocks stands in for
 * all of them without pretending to know which is coming — and a skeleton that
 * guesses the layout wrong is worse than one that only promises "content,
 * shortly".
 *
 * The blocks do NOT pulse. They sit under a frosted overlay that is already
 * blurring them, so a pulse there is a repaint of a blurred layer that nobody
 * can see — it costs a phone battery and buys nothing. The pulsing mark on top
 * carries all the movement this needs.
 */
function Skeleton() {
  return (
    <div aria-hidden className="space-y-6">
      <div className="space-y-2">
        <Block className="h-7 w-44" />
        <Block className="h-4 w-64" />
      </div>

      <Block className="h-28 rounded-2xl" />

      <div className="grid gap-2.5 sm:grid-cols-3">
        <Block className="h-24 rounded-2xl" />
        <Block className="h-24 rounded-2xl" />
        <Block className="h-24 rounded-2xl" />
      </div>

      <div className="space-y-2">
        <Block className="h-5 w-28" />
        <Block className="h-16 rounded-2xl" />
        <Block className="h-16 rounded-2xl" />
        <Block className="h-16 rounded-2xl" />
      </div>
    </div>
  )
}

function Block({ className }: { className?: string }) {
  return <div className={cn('bg-muted rounded-lg', className)} />
}

/**
 * The whole content area, waiting.
 *
 * TWO LAYERS, and each answers a different question. The blocks underneath say
 * how much is coming and where it will sit, so nothing jumps when it lands. The
 * pulsing mark on top says the app is working on it rather than stuck. Either
 * alone is worse: bare blocks look like a screen that failed to fill in, and a
 * spinner over nothing looks like a page that came up blank.
 *
 * The sidebar, the top bar and the tab bar stay put and stay usable throughout,
 * so a mis-tap is one tap to correct instead of a wait to sit through.
 */
export function LoadingScreen({
  label = 'Loading…',
  className,
}: {
  /** What is being fetched. Screen copy, so it addresses the Admin, not "you". */
  label?: string
  className?: string
}) {
  return (
    <div className={cn('animate-in fade-in relative duration-300', className)}>
      <Skeleton />
      <LoadingOverlay label={label} />
    </div>
  )
}

/**
 * Over something already on screen.
 *
 * Absolute, so the parent needs `relative` and its own rounding — the overlay
 * inherits the radius rather than guessing it.
 */
export function LoadingOverlay({
  label = 'Loading…',
  className,
}: {
  label?: string
  className?: string
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'bg-background/50 animate-in fade-in absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 rounded-[inherit] backdrop-blur-[3px] duration-200',
        className,
      )}
    >
      <BrandMark />
      <p className="text-muted-foreground text-xs font-medium">{label}</p>
    </div>
  )
}
