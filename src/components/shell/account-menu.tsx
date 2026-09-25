'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

import { useAccountActions } from './account-actions.tsx'
import { Avatar } from '@/components/avatar.tsx'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

/**
 * The account, behind the avatar in the top bar.
 *
 * THE MENU IS THE WHOLE SCREEN. There is no account page: one thing to do does
 * not earn a section in the sidebar, a route, a heading and a card wrapped
 * around a single button. The avatar is where anyone looks for their own
 * account, and two taps from there is the shortest this can be.
 *
 * IT IS A BARE CIRCLE, not a chip. It used to be a white pill with a ring and a
 * shadow — a control at the same visual volume as the cards below it, which is
 * too much for something opened twice a year, and far too much now that the bar
 * carries nothing else. The tap target is still full size; only the paint is
 * gone, and a soft wash appears under the thumb and while the menu is open so
 * it still answers back.
 *
 * On a phone the trigger is the circle alone; the name and the chevron appear
 * once there is width for them. The same two items also live at the bottom of
 * the phone's "More" menu, because this corner is the one a thumb cannot reach.
 */
export function AccountMenu({ username, isDemo }: { username: string; isDemo: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const { items, surfaces } = useAccountActions({ isDemo, onSelect: () => setMenuOpen(false) })

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger
          aria-label="Account"
          className="group hover:bg-secondary data-[state=open]:bg-secondary flex min-h-11 min-w-11 cursor-pointer items-center justify-center gap-2 rounded-full p-1 transition-colors duration-200 sm:min-h-0 sm:min-w-0 sm:justify-start sm:pr-2.5"
        >
          <Avatar name={username} className="size-8 text-[0.7rem] sm:size-7 sm:text-[0.65rem]" />
          <span className="hidden max-w-32 truncate text-sm font-medium sm:inline">{username}</span>
          <ChevronDown
            className="text-muted-foreground hidden size-3.5 transition-transform duration-200 group-data-[state=open]:rotate-180 sm:block"
            aria-hidden
          />
        </DropdownMenuTrigger>

        {/* THE MENU IS TOLD NOT TO TAKE THE CURSOR BACK on the way out. Radix
            returns focus to the trigger as a menu closes, and the dialog opens
            in that same frame, so the two pull at the cursor together: the form
            opens with nothing focused, or focus lands back on the avatar.
            Refusing the menu's closing focus leaves the dialog to do what it
            already does, which is focus its first field. */}
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

          {items}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Outside the menu, not inside it: menu content unmounts when the menu
          closes, and a dialog mounted within it would close with it. */}
      {surfaces}
    </>
  )
}
