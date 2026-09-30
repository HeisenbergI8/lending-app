'use client'

import { useRef, useState, useTransition } from 'react'
import { Camera, LoaderCircle, Maximize2, Trash2 } from 'lucide-react'

import { Avatar } from '@/components/avatar.tsx'
import { Button } from '@/components/ui/button'
import { NO_ERROR } from '@/lib/form-state.ts'
import { clearBorrowerPhoto, setBorrowerPhoto } from '@/server/borrowers/actions.ts'

import { PhotoViewer } from './photo-viewer.tsx'

/**
 * A borrower's photo, large, with the buttons to set or remove it.
 *
 * TAP A PHOTO TO SEE IT, TAP AN EMPTY CIRCLE TO ADD ONE. With a photo, the
 * circle opens it full screen (see photo-viewer.tsx) and "Change photo" beside
 * it picks a new one; without, the circle itself is the way to add one.
 *
 * TWO PICTURES LEAVE THE PHONE, both made here rather than on the server: a
 * small square cropped from the centre for every circle in the app, and the
 * whole photo, uncropped, at most 1600px on its long side, for the full-screen
 * view. A camera photo is several megabytes; these are tens and a few hundred
 * kilobytes, a fast upload on mobile data, and the same format whatever the
 * camera produced (the browser converts HEIC on the way in).
 */

const SQUARE = 384
const FULL_LONG_SIDE = 1600

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('no blob'))), 'image/jpeg', quality),
  )
}

async function prepare(file: File): Promise<{ square: Blob; full: Blob }> {
  const bitmap = await createImageBitmap(file)
  try {
    const side = Math.min(bitmap.width, bitmap.height)
    const square = document.createElement('canvas')
    square.width = SQUARE
    square.height = SQUARE
    square
      .getContext('2d')
      ?.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, SQUARE, SQUARE)

    const scale = Math.min(1, FULL_LONG_SIDE / Math.max(bitmap.width, bitmap.height))
    const full = document.createElement('canvas')
    full.width = Math.round(bitmap.width * scale)
    full.height = Math.round(bitmap.height * scale)
    full.getContext('2d')?.drawImage(bitmap, 0, 0, full.width, full.height)

    return { square: await toJpeg(square, 0.85), full: await toJpeg(full, 0.85) }
  } finally {
    bitmap.close()
  }
}

export function PhotoPicker({
  borrowerId,
  name,
  photo,
  full,
}: {
  borrowerId: string
  name: string
  photo: string | null
  /** The whole picture for the full-screen view; null for an older photo. */
  full: string | null
}) {
  const input = useRef<HTMLInputElement>(null)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState('')

  const choose = (file: File | undefined) => {
    if (!file) return
    setError('')
    startTransition(async () => {
      try {
        const form = new FormData()
        form.set('borrowerId', borrowerId)
        const made = await prepare(file)
        form.set('photo', new File([made.square], 'photo.jpg', { type: 'image/jpeg' }))
        form.set('full', new File([made.full], 'full.jpg', { type: 'image/jpeg' }))
        const result = await setBorrowerPhoto(NO_ERROR, form)
        if (result.error) setError(result.error)
      } catch {
        setError('That photo could not be read. Try another.')
      }
      // The same file can be picked again after a failure.
      if (input.current) input.current.value = ''
    })
  }

  const remove = () => {
    setError('')
    startTransition(async () => {
      const form = new FormData()
      form.set('borrowerId', borrowerId)
      const result = await clearBorrowerPhoto(NO_ERROR, form)
      if (result.error) setError(result.error)
    })
  }

  return (
    <div className="flex items-center gap-4">
      {photo ? (
        <PhotoViewer name={name} square={photo} full={full}>
          <button
            type="button"
            aria-label={`View ${name}’s photo`}
            className="focus-visible:ring-ring/50 group relative shrink-0 cursor-zoom-in rounded-full focus-visible:ring-3 focus-visible:outline-none"
          >
            <Avatar
              name={name}
              photo={photo}
              className="size-20 text-xl transition-transform duration-200 group-hover:scale-[1.03] group-active:scale-95"
            />
            <span className="bg-card ring-border/70 absolute -right-0.5 -bottom-0.5 flex size-7 items-center justify-center rounded-full ring-1 shadow-rest">
              {pending ? (
                <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <Maximize2 className="size-3.5" aria-hidden />
              )}
            </span>
          </button>
        </PhotoViewer>
      ) : (
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={pending}
          aria-label={`Add a photo of ${name}`}
          className="focus-visible:ring-ring/50 relative shrink-0 cursor-pointer rounded-full focus-visible:ring-3 focus-visible:outline-none"
        >
          <Avatar name={name} className="size-20 text-xl" />
          <span className="bg-card ring-border/70 absolute -right-0.5 -bottom-0.5 flex size-7 items-center justify-center rounded-full ring-1 shadow-rest">
            {pending ? (
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Camera className="size-3.5" aria-hidden />
            )}
          </span>
        </button>
      )}

      <div className="flex flex-col items-start gap-1">
        <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()} disabled={pending}>
          {photo ? 'Change photo' : 'Add photo'}
        </Button>
        {photo ? (
          <Button type="button" variant="ghost" size="sm" onClick={remove} disabled={pending}>
            <Trash2 className="size-3.5" aria-hidden />
            Remove photo
          </Button>
        ) : null}
        {error ? (
          <p className="text-destructive text-xs" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => choose(event.target.files?.[0])}
      />
    </div>
  )
}
