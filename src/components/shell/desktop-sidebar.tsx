'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Landmark } from 'lucide-react'

import { NAV_ITEMS, isActive } from './nav-items.ts'
import { cn } from '@/lib/utils'

/**
 * The laptop sidebar. Hidden on phones, where the bottom tab bar takes over.
 *
 * Deliberately narrow and quiet: it is furniture, not content. The eye should
 * land on the numbers, and a sidebar that competes with them is a sidebar that
 * gets in the way of the work.
 */
export function DesktopSidebar() {
  const pathname = usePathname()

  return (
    <aside className="bg-sidebar text-sidebar-foreground hidden w-56 shrink-0 flex-col border-r md:flex">
      <div className="flex h-14 items-center gap-2 border-b px-4">
        <Landmark className="size-4 shrink-0" aria-hidden />
        <span className="truncate text-sm font-semibold">Lending App</span>
      </div>

      <nav aria-label="Main" className="flex-1 overflow-y-auto p-2">
        <ul className="space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href)
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
                    active
                      ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                      : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
                  )}
                >
                  <item.icon className="size-4 shrink-0" aria-hidden />
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
