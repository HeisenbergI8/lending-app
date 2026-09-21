'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Cannabis } from 'lucide-react'

import { NAV_ITEMS, isActive } from './nav-items.ts'
import { cn } from '@/lib/utils'

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
 */
export function DesktopSidebar() {
  const pathname = usePathname()

  return (
    <aside className="bg-sidebar text-sidebar-foreground sticky top-0 hidden h-dvh w-60 shrink-0 flex-col md:flex">
      <div className="flex h-16 items-center gap-2.5 px-5">
        <span className="bg-brand text-brand-foreground flex size-8 shrink-0 items-center justify-center rounded-[0.6rem]">
          <Cannabis className="size-[1.1rem]" aria-hidden />
        </span>
        <span className="truncate text-[0.95rem] font-semibold tracking-tight text-white">
          Consignment Kush
        </span>
      </div>

      <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-2">
        <ul className="space-y-1">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href)
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    // The sidebar appears from `md`, and plenty of `md` screens
                    // are iPads — so these are finger targets too until the
                    // browser tells us there is a mouse.
                    'flex min-h-11 items-center gap-3 rounded-[0.7rem] px-3 py-2 text-sm font-medium',
                    'transition-colors duration-150 pointer-fine:min-h-0',
                    active
                      ? 'bg-sidebar-primary text-sidebar-primary-foreground shadow-rest'
                      : 'text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                  )}
                >
                  <item.icon className="size-[1.05rem] shrink-0" aria-hidden />
                  {item.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
    </aside>
  )
}
