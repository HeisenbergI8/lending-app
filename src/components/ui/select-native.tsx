import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * A plain <select>, styled to match Input.
 *
 * Deliberately the browser's own control rather than a scripted listbox. On a
 * phone it opens the native picker, which is bigger, faster and more familiar
 * than anything rebuilt in a div, and it costs nothing to ship.
 *
 * Only the arrow is ours — see .select-chevron in globals.css. Every dropdown in
 * the app goes through this one component, so that is the whole of it.
 */
function SelectNative({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      data-slot="select"
      className={cn(
        'select-chevron border-input h-11 w-full min-w-0 cursor-pointer rounded-lg border bg-transparent py-1 pr-10 pl-2 text-base transition-colors outline-none pointer-fine:h-8',
        'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-3',
        'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        'pointer-fine:text-sm dark:bg-input/30',
        className,
      )}
      {...props}
    />
  )
}

export { SelectNative }
