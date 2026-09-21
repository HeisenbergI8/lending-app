import { Cannabis, LogOut } from 'lucide-react'

import { Avatar } from '@/components/avatar.tsx'
import { ActionForm } from '@/components/forms.tsx'
import { logout } from '@/server/auth/actions.ts'

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
      className="bg-background/85 supports-[backdrop-filter]:bg-background/70 border-border/70 sticky z-30 border-b backdrop-blur-xl"
      style={{ top: 'env(safe-area-inset-top, 0px)' }}
    >
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-3 px-4 md:px-6">
        {/* The mark and the name, phones only — on laptops the sidebar already
            carries both, and repeating them would just spend the bar's width. */}
        <span className="flex items-center gap-2 md:hidden">
          <span className="bg-brand text-brand-foreground shadow-rest flex size-8 shrink-0 items-center justify-center rounded-[0.6rem]">
            <Cannabis className="size-[1.1rem]" aria-hidden />
          </span>
          <span className="text-[0.95rem] font-semibold tracking-tight">Consignment Kush</span>
        </span>

        {isDemo ? (
          <span className="border-status-warning/35 bg-status-warning-bg text-status-warning rounded-full border px-2.5 py-1 text-xs font-medium">
            Demo data
          </span>
        ) : null}

        {/* The signed-in person as a chip rather than a bare word: it gives the
            bar a right-hand anchor, and the avatar is the same one their name
            carries everywhere else in the app. */}
        <div className="ml-auto flex items-center gap-1.5">
          <span className="bg-card ring-border/70 shadow-rest hidden items-center gap-2 rounded-full py-1 pr-3 pl-1 ring-1 sm:inline-flex">
            <Avatar name={username} className="size-7 text-[0.65rem]" />
            <span className="max-w-32 truncate text-sm font-medium">{username}</span>
          </span>

          {/* A pill, not a bare ghost link: it sits next to the name chip and
              the two should read as one pair of controls rather than a chip
              and a stray word. It asks first, like delete and restore do —
              this button is next to the avatar and easy to hit by accident. */}
          <ActionForm
            action={logout}
            values={{}}
            variant="outline"
            size="sm"
            buttonClassName="shadow-rest gap-1.5 rounded-full px-3.5"
            pendingLabel="Signing out…"
            confirm={{
              title: 'Sign out?',
              body: 'Admin will be sent back to the sign in screen. Nothing is lost, and signing back in brings everything up again.',
              action: 'Sign out',
            }}
          >
            <LogOut className="size-4" aria-hidden />
            <span className="sr-only sm:not-sr-only">Sign out</span>
          </ActionForm>
        </div>
      </div>
    </header>
  )
}
