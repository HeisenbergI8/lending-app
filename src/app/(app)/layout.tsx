import { DesktopSidebar } from '@/components/shell/desktop-sidebar.tsx'
import { MobileNav } from '@/components/shell/mobile-nav.tsx'
import { PageTransition } from '@/components/shell/page-transition.tsx'
import { TopBar } from '@/components/shell/top-bar.tsx'
import { requireUser } from '@/server/auth/guard.ts'

/**
 * The shell around every signed-in screen.
 *
 * requireUser() runs before any child renders, so nothing under this layout is
 * reachable without a session. Pages still scope their own queries by user id —
 * this guard answers "is anyone signed in", not "whose data is this".
 *
 * Navigation splits by device rather than shrinking one pattern to fit both: a
 * sidebar on a laptop, where there is width to spare and a pointer to use it,
 * and a thumb-reachable tab bar on a phone.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser()

  return (
    <div className="flex min-h-dvh">
      <DesktopSidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar username={user.username} isDemo={user.isDemo} />

        {/* The bottom padding clears the fixed phone tab bar and the home
            indicator beneath it; on a laptop there is no bar, so it drops away. */}
        <main
          className="mx-auto w-full max-w-6xl flex-1 px-4 py-5 md:px-6 md:py-6"
          style={{ paddingBottom: 'calc(5.5rem + env(safe-area-inset-bottom, 0px))' }}
        >
          <PageTransition>{children}</PageTransition>
        </main>
      </div>

      <MobileNav />
    </div>
  )
}
