'use client'

import Image from 'next/image'

import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog'

/**
 * A payment screenshot, shown rather than described.
 *
 * The row used to be a file icon and a link, so checking that the right receipt
 * was attached meant leaving the loan for a browser tab and coming back. A
 * thumbnail answers that at a glance, and the dialog answers the follow-up
 * without the page ever going away.
 *
 * The image is served straight from its signed URL: the bucket is private, so
 * Next's optimizer could not fetch it anyway, and the link expires in minutes.
 * That is also why nothing here is cached or preloaded.
 *
 * PDFs keep the old link. A document needs a reader, not a lightbox.
 */
export function ProofPreview({ url, label, meta }: { url: string; label: string; meta: string }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="bg-muted ring-border/70 focus-visible:ring-ring/50 relative size-10 shrink-0 cursor-pointer overflow-hidden rounded-lg ring-1 focus-visible:ring-3 focus-visible:outline-none"
        >
          <Image src={url} alt="" fill sizes="40px" unoptimized className="object-cover" />
          <span className="sr-only">Open {label}</span>
        </button>
      </DialogTrigger>

      <div className="min-w-0 flex-1 text-sm">
        <DialogTrigger asChild>
          <button type="button" className="cursor-pointer font-medium hover:underline">
            {label}
          </button>
        </DialogTrigger>
        <div className="text-muted-foreground text-xs">{meta}</div>
      </div>

      {/* The close button is pinned to the corner of the panel, so the picture
          starts below it rather than under it: an image edge tucked behind the
          X reads as a rendering fault, and the button's hover state disappears
          into whatever pixel it lands on. */}
      <DialogContent className="max-w-3xl p-3">
        <DialogTitle className="px-1 pt-1.5 pb-3 text-sm">{label}</DialogTitle>
        <div className="ring-border/60 relative h-[70vh] w-full overflow-hidden rounded-xl ring-1">
          <Image
            src={url}
            alt={label}
            fill
            sizes="(max-width: 768px) 100vw, 768px"
            unoptimized
            className="object-contain"
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
