'use client'

import * as React from 'react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { X } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * A modal for a form the admin opened on purpose.
 *
 * The panel this replaced unfolded in place, which put it wherever its trigger
 * happened to sit: pinned to a corner above the page title, or shoving half the
 * screen down to make room. A form is the one thing on screen while it is open,
 * and saying so with the middle of the screen is simpler than finding a spot
 * for it on every page.
 *
 * Unlike the alert dialog, this one is dismissable — by the backdrop, by Escape
 * and by the corner X. The admin opened it, so the admin can close it.
 */

function Dialog(props: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger(props: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogClose(props: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      {/* The overlay does the centring as well as the dimming, so a form taller
          than the screen scrolls inside it rather than running off the top. */}
      <DialogPrimitive.Overlay
        data-slot="dialog-overlay"
        className="bg-foreground/40 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4 backdrop-blur-sm"
      >
        <DialogPrimitive.Content
          data-slot="dialog-content"
          className={cn(
            'bg-popover text-popover-foreground ring-border/70 relative w-full max-w-lg rounded-2xl p-5 shadow-lg ring-1',
            'data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 duration-150',
            className,
          )}
          {...props}
        >
          {children}
          <DialogPrimitive.Close className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring/50 absolute top-4 right-4 inline-flex size-8 items-center justify-center rounded-lg transition-colors focus-visible:ring-3 focus-visible:outline-none">
            <X className="size-4" aria-hidden />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Overlay>
    </DialogPrimitive.Portal>
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('pr-10 text-base font-semibold tracking-tight', className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('text-muted-foreground mt-0.5 pr-10 text-xs', className)}
      {...props}
    />
  )
}

export { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger }
