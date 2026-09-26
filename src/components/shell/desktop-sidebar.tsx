'use client'

import { useEffect, useRef, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { NAV_ITEMS, isActive } from './nav-items.ts'
import { PondexMark } from './pondex-mark.tsx'
import { cn } from '@/lib/utils'

/** Where the retracted/expanded choice is remembered between visits. */
const STORAGE_KEY = 'sidebar-collapsed'

/**
 * One easing and one duration for every part of the retraction — the rail's
 * width, the labels fading, the gaps closing. Three different curves would read
 * as three things happening at once instead of one panel folding away. The curve
 * leaves quickly and lands slowly, which is what makes it feel physical.
 */
const MOTION = 'duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]'

/**
 * localStorage as an external store, read through useSyncExternalStore.
 *
 * The obvious version — useState plus an effect that reads storage — is a
 * cascading render React now warns about. This is the shape React asks for
 * instead: the browser owns the value, the component subscribes to it, and the
 * server snapshot is "expanded" because there is no storage to read there.
 */
let listeners: Array<() => void> = []

function subscribe(onChange: () => void) {
  listeners = [...listeners, onChange]
  return () => {
    listeners = listeners.filter((listener) => listener !== onChange)
  }
}

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    // Private browsing can refuse storage. Expanded is the safe default.
    return false
  }
}

function writeCollapsed(next: boolean) {
  try {
    window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0')
  } catch {
    // The sidebar still retracts for this visit; it just will not be remembered.
  }
  for (const listener of listeners) listener()
}

/**
 * The laptop sidebar. Hidden on phones, where the bottom tab bar takes over.
 *
 * DARK, against light content. It was white on a white page, which made the
 * whole screen one undifferentiated sheet — navigation and data competing at
 * the same volume. A deep surface pushes the furniture back and lets the cards
 * come forward, and it costs nothing but a colour.
 *
 * The active item is a filled brand pill rather than a grey wash: on a dark
 * surface a grey highlight is nearly invisible, and "where am I" is the one
 * question this component exists to answer.
 *
 * It is stuck to the top of the viewport and exactly one screen tall, so a long
 * list scrolls underneath it instead of carrying it off the screen. The nav
 * itself scrolls if the items ever outgrow the height.
 *
 * IT RETRACTS TO AN ICON RAIL, and the choice is remembered so it survives a
 * reload. Retracted it keeps every item — nothing is hidden, only its label —
 * because a rail that dropped sections would make the toggle a decision about
 * what is reachable rather than about how much width the furniture takes. The
 * labels come back as tooltips via `title`, and stay in the accessibility tree
 * as screen-reader text either way.
 *
 * The brand mark is what retracts it — there is no separate collapse control.
 *
 * The width transition is attached after the first paint rather than rendered
 * with the markup: the stored value only arrives once the browser is running, so
 * a class in the markup would have a collapsed visitor watch the sidebar animate
 * shut on every hard reload.
 */
export function DesktopSidebar() {
  const pathname = usePathname()
  const collapsed = useSyncExternalStore(subscribe, readCollapsed, () => false)
  const aside = useRef<HTMLElement>(null)

  useEffect(() => {
    aside.current?.classList.add('transition-[width]', ...MOTION.split(' '))
  }, [])

  return (
    <aside
      ref={aside}
      className={cn(
        'bg-sidebar text-sidebar-foreground sticky top-0 hidden h-dvh shrink-0 flex-col md:flex',
        collapsed ? 'w-16' : 'w-60',
      )}
    >
      {/* THE MARK IS THE TOGGLE. It is the one thing that keeps its place and its
          size in both states, so it can retract the sidebar and bring it back
          without a separate control taking up a row of its own. */}
      <button
        type="button"
        onClick={() => writeCollapsed(!collapsed)}
        aria-expanded={!collapsed}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        className={cn(
          'focus-visible:ring-sidebar-ring group/mark flex h-16 shrink-0 cursor-pointer',
          'items-center text-left select-none active:translate-y-px',
          'focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset',
          'transition-[gap,padding]',
          MOTION,
          collapsed ? 'justify-center gap-0' : 'gap-2.5 px-5',
        )}
      >
        <span
          className={cn(
            'bg-hero flex size-8 text-white shrink-0 items-center justify-center',
            'rounded-[0.6rem] transition-transform duration-150',
            'group-hover/mark:scale-105 group-active/mark:scale-95',
          )}
        >
          <PondexMark className="size-[0.95rem]" />
        </span>
        {/* The name is never unmounted, only squeezed to nothing: a label that
            vanishes the instant the click lands makes the rail feel like it
            snapped, however smoothly the width itself animates. */}
        <span
          className={cn(
            'overflow-hidden text-[0.95rem] font-semibold tracking-tight whitespace-nowrap text-white',
            'transition-[max-width,opacity]',
            MOTION,
            collapsed ? 'max-w-0 opacity-0' : 'max-w-36 opacity-100',
          )}
        >
          Pondex
        </span>
        <span className="sr-only">{collapsed ? 'Expand sidebar' : 'Collapse sidebar'}</span>
      </button>

      <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-2">
        <ul className="space-y-1">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href)
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  title={collapsed ? item.label : undefined}
                  className={cn(
                    // The sidebar appears from `md`, and plenty of `md` screens
                    // are iPads — so these are finger targets too until the
                    // browser tells us there is a mouse.
                    'flex min-h-11 items-center rounded-[0.7rem] px-3 py-2 text-sm font-medium',
                    'transition-[gap,padding,background-color,color] pointer-fine:min-h-0',
                    MOTION,
                    collapsed ? 'justify-center gap-0 px-0' : 'gap-3',
                    active
                      ? 'bg-sidebar-primary text-sidebar-primary-foreground shadow-rest'
                      : 'text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                  )}
                >
                  <item.icon className="size-[1.05rem] shrink-0" aria-hidden />
                  <span
                    className={cn(
                      'overflow-hidden whitespace-nowrap transition-[max-width,opacity]',
                      MOTION,
                      collapsed ? 'max-w-0 opacity-0' : 'max-w-40 opacity-100',
                    )}
                  >
                    {item.label}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
    </aside>
  )
}
