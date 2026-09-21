'use client'

import { usePathname } from 'next/navigation'

/**
 * A short entrance on every navigation.
 *
 * Keyed on the pathname, so React discards the old subtree and mounts a new one —
 * which is what re-runs the animation. Without the key, React would reuse the
 * element and nothing would move.
 *
 * Deliberately small: 200ms, a few pixels of rise, no horizontal slide. Movement
 * here is meant to say "the page changed", not to be noticed. Anything longer
 * sits between the tap and the content, and on a tool used dozens of times a day
 * that becomes a tax.
 *
 * The reduced-motion rule in globals.css collapses this to nothing for anyone who
 * has asked the system for less movement.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  return (
    <div key={pathname} className="animate-in fade-in slide-in-from-bottom-1 duration-200">
      {children}
    </div>
  )
}
