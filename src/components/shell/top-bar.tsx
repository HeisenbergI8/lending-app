import { Cannabis } from 'lucide-react'

import { AccountMenu } from './account-menu.tsx'

/**
 * The bar across the top of every signed-in screen.
 *
 * Sticky, and its top padding includes the device's safe-area inset so it clears
 * the notch rather than hiding behind it.
 *
 * The demo badge is not decoration: the whole point of a separate demo account
 * is that nobody mistakes sample borrowers for real ones, and the only way that
 * holds is if the distinction is visible on every screen.
 *
 * THE AVATAR IS THE ACCOUNT, and everything that belongs to it lives in the menu
 * behind it rather than in the sidebar: one thing to do does not earn a section
 * next to Loans and Borrowers. This bar is on phones too, so that menu is the
 * way in at every width and the phone tab bar keeps the sections it had.
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
            carries everywhere else in the app. Everything belonging to the
            account, signing out included, is behind it — one control in the
            corner rather than two side by side. */}
        <div className="ml-auto flex items-center">
          <AccountMenu username={username} isDemo={isDemo} />
        </div>
      </div>
    </header>
  )
}
