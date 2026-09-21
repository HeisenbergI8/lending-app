import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * A plain <select>, styled to match Input.
 *
 * Deliberately the browser's own control rather than a scripted listbox. On a
 * phone it opens the native picker, which is bigger, faster and more familiar
 * than anything rebuilt in a div, and it costs nothing to ship.
 */
function SelectNative({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      data-slot="select"
      className={cn(
        'border-input h-11 w-full min-w-0 rounded-lg border bg-transparent px-2 py-1 text-base transition-colors outline-none pointer-fine:h-8',
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
