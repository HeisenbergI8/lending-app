'use client'

import { useActionState, useRef, useState, useSyncExternalStore } from 'react'
import { KeyRound, LogOut, Volume2, VolumeX } from 'lucide-react'

import { AppearanceItems } from './appearance.tsx'
import { FormDialog } from '@/components/forms.tsx'
import { PasswordInput } from '@/components/password-input.tsx'
import { Avatar } from '@/components/avatar.tsx'
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { Label } from '@/components/ui/label'
import { NO_ERROR } from '@/lib/form-state.ts'
import { isMuted, play, setMuted, subscribeMuted, withSound } from '@/lib/sound.ts'
import { changePassword, logout } from '@/server/auth/actions.ts'

/**
 * The look shared by both account menus: a full-width panel on a phone rather
 * than a narrow one, rows tall enough for a thumb, and a gap from the screen
 * edge so the panel does not look cut off against it.
 */
export const MENU = 'w-[min(20rem,calc(100vw-2rem))] rounded-2xl p-2 shadow-xl'
export const MENU_EDGE_GAP = 16
export const ITEM = 'gap-3 rounded-xl px-3 py-2.5 text-[15px] [&_svg]:size-[18px] not-data-[variant=destructive]:[&_svg]:text-muted-foreground'

export function AccountHeader({ username, isDemo }: { username: string; isDemo: boolean }) {
  return (
    <DropdownMenuLabel className="bg-muted/60 mb-1 flex items-center gap-3 rounded-xl px-3 py-3">
      <Avatar name={username} className="size-10 text-sm" />
      <span className="min-w-0">
        <span className="text-foreground block truncate text-[15px] font-semibold">{username}</span>
        <span className="block truncate text-xs font-normal">
          {isDemo ? 'Demo account' : 'Signed in on this device'}
        </span>
      </span>
    </DropdownMenuLabel>
  )
}

const logoutWithSound = withSound(logout, 'signOut')

/**
 * The two things an account can do — change its password, sign out — offered
 * from two places.
 *
 * WHY TWICE. The avatar in the top bar is where anyone looks for their own
 * account, and the top corner is the right home for something used twice a
 * year rather than twice a day. But that corner is also the one part of a phone
 * a thumb cannot reach without shifting grip, so the same two items also sit at
 * the bottom of "More", which is in the thumb's own zone. One way in for where
 * people look, one for where their hand already is.
 *
 * IT IS A HOOK RETURNING TWO PIECES rather than one component, because the
 * pieces cannot be rendered in the same place. `items` belong inside the menu;
 * `surfaces` must sit OUTSIDE it, because menu content unmounts as the menu
 * closes and would take an open dialog down with it. Sharing them this way is
 * what stops the password form and the sign-out action existing twice, which is
 * how the two menus would quietly come to differ.
 *
 * `onSelect` is how the caller closes its own menu. Radix would close it for us,
 * but not before the dialog opens in the same frame, and the two then pull at
 * the cursor together — so the item stops the automatic close and the caller
 * does it deliberately.
 */
export function useAccountActions({ isDemo, onSelect }: { isDemo: boolean; onSelect: () => void }) {
  const [changing, setChanging] = useState(false)

  // The form lives outside any menu and is asked to submit from the item, so
  // the menu closing cannot take the form down with it mid-submit.
  const signOutRef = useRef<HTMLFormElement>(null)
  const [, signOut] = useActionState(logoutWithSound, NO_ERROR)
  // The server has no say in this, so it renders as on until the browser answers.
  const muted = useSyncExternalStore(subscribeMuted, isMuted, () => false)

  const items = (
    <>
      {/* The demo account gets the reason rather than a dead item: its password
          is printed on the sign in screen, and changing it would lock out
          whoever opens the link next. The server refuses it too. */}
      {isDemo ? (
        <p className="text-muted-foreground px-3 py-2 text-xs">
          The demo password stays as it is. It is printed on the sign in screen so anyone with the
          link can try the app.
        </p>
      ) : (
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault()
            onSelect()
            setChanging(true)
          }}
          className={ITEM}
        >
          <KeyRound aria-hidden />
          Change password
        </DropdownMenuItem>
      )}

      <DropdownMenuSeparator className="my-1.5" />

      <AppearanceItems />

      <DropdownMenuSeparator className="my-1.5" />

      {/* The menu stays open on purpose, so the Admin sees the switch flip. */}
      <DropdownMenuItem
        onSelect={(event) => {
          event.preventDefault()
          setMuted(!muted)
          if (muted) play('save')
        }}
        className={ITEM}
      >
        {muted ? <VolumeX aria-hidden /> : <Volume2 aria-hidden />}
        {muted ? 'Sounds off' : 'Sounds on'}
      </DropdownMenuItem>

      <DropdownMenuSeparator className="my-1.5" />

      {/* SIGNING OUT HAS NO "ARE YOU SURE", deliberately. The dialog was there
          because the button sat against the avatar in the bar, where a thumb
          finds it by accident; reaching it now takes opening a menu and choosing
          the item, which is the same two deliberate steps the dialog was asking
          for. Nothing is lost either way: signing back in brings it all up. */}
      <DropdownMenuItem
        variant="destructive"
        onSelect={() => signOutRef.current?.requestSubmit()}
        className={ITEM}
      >
        <LogOut aria-hidden />
        Sign out
      </DropdownMenuItem>
    </>
  )

  const surfaces = (
    <>
      <form ref={signOutRef} action={signOut} className="hidden" />

      <FormDialog
        action={changePassword}
        sound="save"
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

  return { items, surfaces }
}
