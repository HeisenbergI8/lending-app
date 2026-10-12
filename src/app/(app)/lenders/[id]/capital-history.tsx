'use client'

import { useState } from 'react'
import { History } from 'lucide-react'

import { FormDialog } from '@/components/forms.tsx'
import { Money } from '@/components/money.tsx'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { centavos } from '@/lib/money/centavos.ts'
import { setStartingCapital } from '@/server/lenders/actions.ts'

/**
 * The last line of the starting capital history: the figure from before top-ups
 * were recorded (Lender.startingCapitalCentavos). Tap it to correct it.
 */
export function OpeningCapitalRow({ lenderId, opening }: { lenderId: string; opening: number }) {
  const [open, setOpen] = useState(false)

  return (
    <li className="hover:bg-muted/40 relative flex items-center gap-3 p-3 transition-colors duration-150">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="focus-visible:ring-ring/60 absolute inset-0 focus-visible:ring-2 focus-visible:outline-none"
      >
        <span className="sr-only">Edit the amount before the history started</span>
      </button>
      <span className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-full">
        <History className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">Before the history started</div>
        <div className="text-muted-foreground mt-0.5 text-xs">Tap to correct</div>
      </div>
      {opening === 0 ? (
        <span className="text-muted-foreground text-sm">Not set</span>
      ) : (
        <Money amount={centavos(opening)} variant="display" className="text-sm font-semibold" />
      )}

      {/* THE FIGURE IS TYPED, and this is the only place it can be. It is not a
          deposit: nothing moves, nothing is lent, and no other figure on any
          screen changes when it is saved. The description says so, because a box
          asking for pesos inside an app that records money in and money out will
          otherwise be read as recording money in.

          Pre-filled in PESOS from the stored centavos, with no thousands
          separators — parsePesos accepts them, but a value typed back out of this
          box has to round-trip exactly, and "155,177.00" re-read as a default is
          one comma away from a different number.

          Blank saves as "not set" rather than ₱0.00, which is the only way to
          take a figure typed by mistake back off the screen. */}
      <FormDialog
        action={setStartingCapital}
        sound="save"
        open={open}
        onOpenChange={setOpen}
        title="Before the history started"
        description="What this person had put in before top-ups were recorded here. Saving it moves no money: Floating does not change."
        submitLabel="Save"
      >
        <input type="hidden" name="lenderId" value={lenderId} />
        <div className="space-y-2">
          <Label htmlFor="startingCapital">Amount in pesos</Label>
          <Input
            id="startingCapital"
            name="startingCapital"
            inputMode="decimal"
            defaultValue={opening === 0 ? '' : (opening / 100).toFixed(2)}
            placeholder="80000"
            autoFocus
          />
          <p className="text-muted-foreground text-xs">
            New money from now on goes in as a top-up instead. Leave it blank if you do not know what they started with.
          </p>
        </div>
      </FormDialog>

    </li>
  )
}
