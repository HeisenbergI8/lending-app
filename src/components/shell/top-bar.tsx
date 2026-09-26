import { AccountMenu } from './account-menu.tsx'
import { ThemeToggle } from './appearance.tsx'
import { CollapsedTitle } from './collapsed-title.tsx'

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
 * THERE IS NO LOGO IN IT. The admin knows which app she opened; the mark earns
 * its place on the home screen icon, the splash and the sign-in card, and
 * nowhere else. What the bar carries instead is the name of the screen she is
 * on, and only once her own heading has scrolled out from under it.
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
      {/* Shorter on a phone, where every row costs something, and left at 16 on a
          laptop so it lines up with the sidebar's own header. */}
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4 md:h-16 md:px-6">
        <CollapsedTitle />

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
        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
          <AccountMenu username={username} isDemo={isDemo} />
        </div>
      </div>
    </header>
  )
}
