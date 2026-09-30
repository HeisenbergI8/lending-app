'use client'

import { useEffect, useSyncExternalStore } from 'react'
import { Check, Moon, Smartphone, Sun } from 'lucide-react'

import { DropdownMenuItem, DropdownMenuLabel } from '@/components/ui/dropdown-menu'
import {
  type Accent,
  applyTheme,
  getAccent,
  getThemeMode,
  isDark,
  setAccent,
  setThemeMode,
  subscribeTheme,
  type ThemeMode,
} from '@/lib/theme.ts'
import { cn } from '@/lib/utils'

/**
 * The one-tap switch in the top bar.
 *
 * BOTH ICONS ARE ALWAYS THERE. Which one shows is decided by the `dark` class
 * on <html>, not by React state, so the right one is painted on the very first
 * frame, before the page has hydrated. The outgoing icon turns and shrinks away
 * as the incoming one turns in with a small overshoot, the way iOS swaps a
 * symbol.
 */
export function ThemeToggle() {
  // The server has no say in this, so it renders as light until the browser answers.
  const dark = useSyncExternalStore(subscribeTheme, () => isDark(), () => false)

  // The inline script set the page's colours; this catches the phone's status
  // bar up with them.
  useEffect(() => applyTheme({ animate: false }), [])

  return (
    <button
      type="button"
      onClick={() => setThemeMode(dark ? 'light' : 'dark')}
      aria-label="Dark mode"
      aria-pressed={dark}
      className="hover:bg-secondary relative flex size-11 cursor-pointer items-center justify-center rounded-full transition-colors duration-200 active:scale-95 sm:size-10"
    >
      <Sun
        aria-hidden
        className="theme-icon absolute size-[18px] transition-[rotate,scale,opacity] duration-500 ease-[cubic-bezier(0.34,1.4,0.64,1)] dark:scale-30 dark:-rotate-90 dark:opacity-0"
      />
      <Moon
        aria-hidden
        className="theme-icon absolute size-[18px] scale-30 rotate-90 opacity-0 transition-[rotate,scale,opacity] duration-500 ease-[cubic-bezier(0.34,1.4,0.64,1)] dark:scale-100 dark:rotate-0 dark:opacity-100"
      />
    </button>
  )
}

const OPTIONS: { mode: ThemeMode; label: string; icon: typeof Sun }[] = [
  { mode: 'light', label: 'Light', icon: Sun },
  { mode: 'dark', label: 'Dark', icon: Moon },
  { mode: 'system', label: 'Device', icon: Smartphone },
]

/**
 * Light, Dark or Device, as a segmented control inside the account menu.
 *
 * This is the only place "Device" can be chosen: the bar's button is a plain
 * light or dark switch, because a button with three states means tapping to
 * find out what it does.
 *
 * EACH SEGMENT IS A MENU ITEM, laid side by side. That keeps them reachable
 * with the arrow keys like everything else in the menu, which ordinary buttons
 * inside a menu are not. Choosing one leaves the menu open, so the Admin sees
 * the page change behind it.
 */
export function AppearanceItems() {
  const mode = useSyncExternalStore(subscribeTheme, getThemeMode, () => 'light' as const)
  const index = OPTIONS.findIndex((option) => option.mode === mode)

  return (
    <>
      <DropdownMenuLabel className="text-muted-foreground px-3 pt-2 pb-1.5 text-xs font-medium">
        Appearance
      </DropdownMenuLabel>
      <div className="bg-muted relative mx-1 mb-1 grid grid-cols-3 rounded-xl p-[3px]">
        {/* The thumb slides rather than jumps, on the same curve iOS uses. */}
        <span
          aria-hidden
          className="bg-card absolute inset-y-[3px] left-[3px] w-[calc((100%-6px)/3)] rounded-[0.6rem] shadow-sm ring-1 ring-black/5 transition-transform duration-400 ease-[cubic-bezier(0.32,0.72,0,1)] dark:ring-white/10"
          style={{ transform: `translateX(${index * 100}%)` }}
        />
        {OPTIONS.map((option) => (
          <DropdownMenuItem
            key={option.mode}
            role="menuitemradio"
            aria-checked={mode === option.mode}
            onSelect={(event) => {
              event.preventDefault()
              setThemeMode(option.mode)
            }}
            className={cn(
              'relative z-10 justify-center gap-1.5 rounded-[0.6rem] px-1 py-2 text-[13px] font-medium focus:bg-transparent focus-visible:ring-2 focus-visible:ring-ring/40 [&_svg]:size-3.5',
              mode === option.mode ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            <option.icon aria-hidden />
            {option.label}
          </DropdownMenuItem>
        ))}
      </div>
    </>
  )
}

/**
 * The swatch each colour theme shows. Literal colours rather than tokens: a
 * swatch has to show the OTHER themes too, while only one is applied. They are
 * the light-theme brand of each palette in globals.css.
 */
const SWATCHES: { accent: Accent; label: string; color: string }[] = [
  { accent: 'navy', label: 'Navy', color: 'oklch(0.393 0.134 260.2)' },
  { accent: 'pink', label: 'Pink', color: 'oklch(0.56 0.2 356)' },
  { accent: 'violet', label: 'Violet', color: 'oklch(0.47 0.19 300)' },
  { accent: 'teal', label: 'Teal', color: 'oklch(0.5 0.1 195)' },
  { accent: 'graphite', label: 'Graphite', color: 'oklch(0.32 0.012 260)' },
]

/**
 * The colour theme, as a row of swatches under Light / Dark / Device.
 *
 * Menu items for the same reason as the segments above: arrow keys reach them,
 * and choosing one leaves the menu open so the whole app can be seen changing
 * behind it. The chosen one carries a tick as well as a ring, so it does not
 * rest on colour alone.
 */
export function ColourItems() {
  const accent = useSyncExternalStore(subscribeTheme, getAccent, () => 'navy' as const)

  return (
    <>
      <DropdownMenuLabel className="text-muted-foreground px-3 pt-2 pb-1.5 text-xs font-medium">
        Colour
      </DropdownMenuLabel>
      <div className="mx-1 mb-1 flex items-center justify-between gap-1 px-1">
        {SWATCHES.map((swatch) => {
          const on = accent === swatch.accent
          return (
            <DropdownMenuItem
              key={swatch.accent}
              role="menuitemradio"
              aria-checked={on}
              aria-label={swatch.label}
              title={swatch.label}
              onSelect={(event) => {
                event.preventDefault()
                setAccent(swatch.accent)
              }}
              className="flex size-11 items-center justify-center rounded-full p-0 focus:bg-transparent focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <span
                aria-hidden
                className={cn(
                  'flex size-8 items-center justify-center rounded-full text-white transition-transform duration-200',
                  on ? 'ring-foreground/80 ring-offset-popover scale-110 ring-2 ring-offset-2' : 'ring-1 ring-black/10',
                )}
                style={{ backgroundColor: swatch.color }}
              >
                {on ? <Check className="size-4" strokeWidth={3} /> : null}
              </span>
            </DropdownMenuItem>
          )
        })}
      </div>
    </>
  )
}
