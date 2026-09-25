'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { MoreHorizontal, Plus } from 'lucide-react'

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
 *
 * The middle slot is not a tab. Recording a loan is the one thing done while
 * standing in front of somebody, and it used to be a button at the TOP of the
 * Loans screen — the far corner of a 6.7" phone, two taps away. It is a raised
 * circle rather than a fifth icon because it goes somewhere you come back from,
 * and it is dead centre, which is why only four tabs sit around it.
 */
export function MobileNav() {
  const pathname = usePathname()
  const primary = NAV_ITEMS.filter((item) => item.primary)
  const overflow = NAV_ITEMS.filter((item) => !item.primary)
  const overflowActive = overflow.some((item) => isActive(pathname, item.href))
  // Two tabs, the Record button, two tabs. An odd split would leave the circle
  // off-centre, which on a bar this wide reads as a mistake rather than a choice.
  const half = Math.ceil(primary.length / 2)

  const tab = (item: (typeof primary)[number]) => {
    const active = isActive(pathname, item.href)
    return (
      <li key={item.href} className="flex-1">
        <Link
          href={item.href}
          aria-current={active ? 'page' : undefined}
          className={cn(
            'relative flex flex-col items-center gap-1 px-1 py-2.5 text-[11px] font-medium transition-colors',
            active ? 'text-brand' : 'text-muted-foreground active:text-foreground',
          )}
        >
          <span
            className={cn(
              'flex items-center justify-center rounded-full px-4 py-1 transition-all duration-300 ease-out',
              active ? 'bg-brand-bg' : 'bg-transparent',
            )}
          >
            <item.icon className="size-5" aria-hidden />
          </span>
          {item.short}
        </Link>
      </li>
    )
  }

  return (
    <nav
      aria-label="Main"
      className="bg-background/85 supports-[backdrop-filter]:bg-background/70 border-border/70 fixed inset-x-0 bottom-0 z-40 border-t backdrop-blur-xl md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <ul className="flex items-stretch">
        {primary.slice(0, half).map(tab)}

        <li className="flex-1">
          <Link
            href="/loans/new"
            aria-label="Record a loan"
            className="text-muted-foreground flex flex-col items-center gap-1 px-1 py-2.5 text-[11px] font-medium"
          >
            {/* The negative top margin is what keeps the bar the height it was:
                the circle is 48px against the tabs' 28px pill, and it spends the
                difference rising out of the bar instead of pushing it taller.
                The ring is the background colour, so the bar reads as notched
                around the button rather than overlapped by it. */}
            <span className="bg-brand text-brand-foreground ring-background shadow-hover -mt-5 flex size-12 items-center justify-center rounded-full ring-4 transition-transform duration-150 active:scale-95">
              <Plus className="size-6" aria-hidden />
            </span>
            Record
          </Link>
        </li>

        {primary.slice(half).map(tab)}

        <li className="flex-1">
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                'flex w-full flex-col items-center gap-1 px-1 py-2.5 text-[11px] font-medium transition-colors',
                overflowActive ? 'text-brand' : 'text-muted-foreground',
              )}
            >
              <span
                className={cn(
                  'flex items-center justify-center rounded-full px-4 py-1 transition-all duration-300 ease-out',
                  overflowActive ? 'bg-brand-bg' : 'bg-transparent',
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
