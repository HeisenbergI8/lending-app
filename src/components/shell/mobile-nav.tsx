'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { MoreHorizontal } from 'lucide-react'

import { NAV_ITEMS, isActive } from './nav-items.ts'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

/**
 * The phone tab bar.
 *
 * Fixed to the bottom because that is where a thumb reaches — the top of a
 * modern phone is the hardest place to tap one-handed, and this app is used
 * standing up, recording a loan on the spot.
 *
 * The bar adds the device's own safe-area inset to its padding so it sits above
 * the home indicator rather than under it. Without that the last few pixels of
 * every tab are untappable on a modern iPhone.
 *
 * The active tab animates its pill rather than just recolouring: movement tells
 * you which way you went. It is a layout animation on a single element, not a
 * transition on six, so it stays cheap.
 */
export function MobileNav() {
  const pathname = usePathname()
  const primary = NAV_ITEMS.filter((item) => item.primary)
  const overflow = NAV_ITEMS.filter((item) => !item.primary)
  const overflowActive = overflow.some((item) => isActive(pathname, item.href))

  return (
    <nav
      aria-label="Main"
      className="bg-background/80 supports-[backdrop-filter]:bg-background/65 fixed inset-x-0 bottom-0 z-40 border-t backdrop-blur-lg md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <ul className="flex items-stretch">
        {primary.map((item) => {
          const active = isActive(pathname, item.href)
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex flex-col items-center gap-1 px-1 py-2.5 text-[11px] font-medium transition-colors',
                  active ? 'text-primary' : 'text-muted-foreground active:text-foreground',
                )}
              >
                <span
                  className={cn(
                    'flex items-center justify-center rounded-full px-4 py-1 transition-all duration-300 ease-out',
                    active ? 'bg-primary/10' : 'bg-transparent',
                  )}
                >
                  <item.icon className="size-5" aria-hidden />
                </span>
                {item.short}
              </Link>
            </li>
          )
        })}

        <li className="flex-1">
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                'flex w-full flex-col items-center gap-1 px-1 py-2.5 text-[11px] font-medium transition-colors',
                overflowActive ? 'text-primary' : 'text-muted-foreground',
              )}
            >
              <span
                className={cn(
                  'flex items-center justify-center rounded-full px-4 py-1 transition-all duration-300 ease-out',
                  overflowActive ? 'bg-primary/10' : 'bg-transparent',
                )}
              >
                <MoreHorizontal className="size-5" aria-hidden />
              </span>
              More
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="top" className="mb-2 min-w-40">
              {overflow.map((item) => (
                <DropdownMenuItem key={item.href} asChild>
                  <Link href={item.href} className="gap-2">
                    <item.icon className="size-4" aria-hidden />
                    {item.label}
                  </Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </li>
      </ul>
    </nav>
  )
}
