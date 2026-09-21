import { logout } from '@/server/auth/actions.ts'
import { requireUser } from '@/server/auth/guard.ts'
import { Button } from '@/components/ui/button'

/**
 * The shell around every signed-in screen.
 *
 * requireUser() runs before any child renders, so a page under this layout
 * cannot be reached without a session. Pages still scope their own queries by
 * user id — this guard answers "is anyone logged in", not "whose data is this".
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser()

  return (
    <div className="min-h-dvh">
      <header
        className="bg-background/95 supports-[backdrop-filter]:bg-background/70 sticky z-10 border-b backdrop-blur"
        style={{ top: 'env(safe-area-inset-top, 0px)' }}
      >
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 py-3">
          <span className="font-semibold">Lending App</span>

          {user.isDemo ? (
            <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
              Demo data
            </span>
          ) : null}

          <div className="ml-auto flex items-center gap-3">
            <span className="text-muted-foreground text-sm">{user.username}</span>
            <form action={logout}>
              <Button type="submit" variant="outline" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  )
}
