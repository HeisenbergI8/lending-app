'use client'

import { useActionState, useRef, useState } from 'react'
import { ChevronDown, KeyRound, LogOut } from 'lucide-react'

import { Avatar } from '@/components/avatar.tsx'
import { FormDialog } from '@/components/forms.tsx'
import { PasswordInput } from '@/components/password-input.tsx'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Label } from '@/components/ui/label'
import { NO_ERROR } from '@/lib/form-state.ts'
import { changePassword, logout } from '@/server/auth/actions.ts'

/**
 * The account, behind the avatar in the top bar.
 *
 * THE MENU IS THE WHOLE SCREEN. There is no account page: one thing to do does
 * not earn a section in the sidebar, a route, a heading and a card wrapped
 * around a single button. The avatar is where anyone looks for their own
 * account, and two clicks from there is the shortest this can be.
 *
 * On a phone the trigger is the avatar alone, at the size a thumb needs; the
 * name and the chevron appear once there is width for them.
 *
 * SIGNING OUT LOST ITS "ARE YOU SURE", and deliberately. The dialog was there
 * because the button sat against the avatar in the bar, where a thumb finds it
 * by accident; reaching it now takes opening a menu and choosing the item,
 * which is the same two deliberate steps the dialog was asking for. A third
 * one only teaches the admin to dismiss dialogs unread. Nothing is lost either
 * way: signing back in brings everything up again.
 *
 * THE MENU IS TOLD NOT TO TAKE THE CURSOR BACK on the way out. Radix returns
 * focus to the trigger as a menu closes, and the dialog opens in that same
 * frame, so the two pull at the cursor together: the form opens with nothing
 * focused, or focus lands back on the avatar. Refusing the menu's closing focus
 * leaves the dialog to do what it already does, which is focus its first field.
 * A timer would work too, and would be a guess about how long the menu takes.
 */
export function AccountMenu({ username, isDemo }: { username: string; isDemo: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [changing, setChanging] = useState(false)

  // The form lives outside the menu and is asked to submit from the item, so
  // the menu closing cannot take the form down with it mid-submit.
  const signOutRef = useRef<HTMLFormElement>(null)
  const [, signOut] = useActionState(logout, NO_ERROR)

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger
          aria-label="Account"
          className="group bg-card ring-border/70 shadow-rest hover:shadow-hover hover:ring-brand-line data-[state=open]:shadow-hover data-[state=open]:ring-brand-line flex min-h-11 min-w-11 cursor-pointer items-center justify-center gap-2 rounded-full p-1 ring-1 transition-[box-shadow,--tw-ring-color] duration-200 sm:min-h-0 sm:min-w-0 sm:justify-start sm:pr-2.5"
        >
          <Avatar name={username} className="size-7 text-[0.65rem]" />
          <span className="hidden max-w-32 truncate text-sm font-medium sm:inline">{username}</span>
          <ChevronDown
            className="text-muted-foreground hidden size-3.5 transition-transform duration-200 group-data-[state=open]:rotate-180 sm:block"
            aria-hidden
          />
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align="end"
          sideOffset={8}
          className="min-w-56"
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <DropdownMenuLabel className="flex items-center gap-2.5 py-2">
            <Avatar name={username} className="size-8 text-[0.7rem]" />
            <span className="min-w-0">
              <span className="text-foreground block truncate text-sm font-medium">{username}</span>
              <span className="block truncate text-xs font-normal">
                {isDemo ? 'Demo account' : 'Signed in on this device'}
              </span>
            </span>
          </DropdownMenuLabel>

          <DropdownMenuSeparator />

          {/* The demo account gets the reason rather than a dead item: its
              password is printed on the sign in screen, and changing it would
              lock out whoever opens the link next. The server refuses it too. */}
          {isDemo ? (
            <p className="text-muted-foreground px-2 py-1.5 text-xs">
              The demo password stays as it is. It is printed on the sign in screen so anyone
              with the link can try the app.
            </p>
          ) : (
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault()
                setMenuOpen(false)
                setChanging(true)
              }}
              className="gap-2 px-2 py-2"
            >
              <KeyRound className="size-4" aria-hidden />
              Change password
            </DropdownMenuItem>
          )}

          <DropdownMenuSeparator />

          <DropdownMenuItem
            variant="destructive"
            onSelect={() => signOutRef.current?.requestSubmit()}
            className="gap-2 px-2 py-2"
          >
            <LogOut className="size-4" aria-hidden />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <form ref={signOutRef} action={signOut} className="hidden" />

      {/* Outside the menu, not inside it: menu content unmounts when the menu
          closes, and a dialog mounted within it would close with it. */}
      <FormDialog
        action={changePassword}
        open={changing}
        onOpenChange={setChanging}
        title="Change password"
        description="Admin stays signed in on this device. Every other device is signed out."
        submitLabel="Change password"
      >
        <div className="space-y-2">
          <Label htmlFor="currentPassword">Current password</Label>
          <PasswordInput
            id="currentPassword"
            name="currentPassword"
            autoComplete="current-password"
            required
            autoFocus
          />
        </div>

        {/* The two new boxes sit together on their own surface, so the form
            reads as "what it is now" and then "what it becomes" rather than as
            three boxes that all look alike. */}
        <div className="bg-muted/40 ring-border/60 space-y-3 rounded-xl p-3 ring-1">
          <div className="space-y-2">
            <Label htmlFor="newPassword">New password</Label>
            <PasswordInput
              id="newPassword"
              name="newPassword"
              autoComplete="new-password"
              // The browser is told the rule as well as the admin, so a password
              // manager generates one that will be accepted rather than one the
              // server then refuses.
              minLength={8}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirmPassword">New password again</Label>
            <PasswordInput
              id="confirmPassword"
              name="confirmPassword"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>

          <p className="text-muted-foreground text-xs">At least 8 characters.</p>
        </div>
      </FormDialog>
    </>
  )
}
