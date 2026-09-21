import { LogOut } from 'lucide-react'

import { logout } from '@/server/auth/actions.ts'
import { Button } from '@/components/ui/button'

/**
 * The bar across the top of every signed-in screen.
 *
 * Sticky, and its top padding includes the device's safe-area inset so it clears
 * the notch rather than hiding behind it.
 *
 * The demo badge is not decoration: the whole point of a separate demo account
 * is that nobody mistakes sample borrowers for real ones, and the only way that
 * holds is if the distinction is visible on every screen.
 */
export function TopBar({ username, isDemo }: { username: string; isDemo: boolean }) {
  return (
    <header
      className="bg-background/80 supports-[backdrop-filter]:bg-background/65 sticky z-30 border-b backdrop-blur-lg"
      style={{ top: 'env(safe-area-inset-top, 0px)' }}
    >
      <div className="flex h-14 items-center gap-3 px-4">
        <span className="text-sm font-semibold md:hidden">Lending App</span>

        {isDemo ? (
          <span className="border-status-warning/35 bg-status-warning-bg text-status-warning rounded-full border px-2 py-0.5 text-xs font-medium">
            Demo data
          </span>
        ) : null}

        <div className="ml-auto flex items-center gap-2">
          <span className="text-muted-foreground hidden text-sm sm:inline">{username}</span>
          <form action={logout}>
            <Button type="submit" variant="ghost" size="sm" className="gap-1.5">
              <LogOut className="size-4" aria-hidden />
              <span className="sr-only sm:not-sr-only">Sign out</span>
            </Button>
          </form>
        </div>
      </div>
    </header>
  )
}
