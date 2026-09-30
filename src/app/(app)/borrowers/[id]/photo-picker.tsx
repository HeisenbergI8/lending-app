'use client'

import { useRef, useState, useTransition } from 'react'
import { Camera, LoaderCircle, Trash2 } from 'lucide-react'

import { Avatar } from '@/components/avatar.tsx'
import { Button } from '@/components/ui/button'
import { NO_ERROR } from '@/lib/form-state.ts'
import { clearBorrowerPhoto, setBorrowerPhoto } from '@/server/borrowers/actions.ts'

/**
 * A borrower's photo, large, with the buttons to set or remove it.
 *
 * SHRUNK ON THE PHONE, NOT THE SERVER. A photo from an iPhone camera is several
 * megabytes; the circle it fills is at most 96px across. So the picture is
 * cropped to its centre square and redrawn at 512px as a JPEG before it leaves
 * the device — tens of kilobytes, a fast upload on mobile data, and the same
 * format whatever the camera produced (the browser converts HEIC on the way in).
 */

const SIZE = 512

async function squareJpeg(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const side = Math.min(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const context = canvas.getContext('2d')
  if (!context) throw new Error('no canvas')
  context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, SIZE, SIZE)
  bitmap.close()
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('no blob'))), 'image/jpeg', 0.85),
  )
}

export function PhotoPicker({ borrowerId, name, photo }: { borrowerId: string; name: string; photo: string | null }) {
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
        form.set('photo', new File([await squareJpeg(file)], 'photo.jpg', { type: 'image/jpeg' }))
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
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={pending}
        aria-label={photo ? `Change ${name}’s photo` : `Add a photo of ${name}`}
        className="focus-visible:ring-ring/50 relative shrink-0 cursor-pointer rounded-full focus-visible:ring-3 focus-visible:outline-none"
      >
        <Avatar name={name} photo={photo} className="size-20 text-xl" />
        <span className="bg-card ring-border/70 absolute -right-0.5 -bottom-0.5 flex size-7 items-center justify-center rounded-full ring-1 shadow-rest">
          {pending ? (
            <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <Camera className="size-3.5" aria-hidden />
          )}
        </span>
      </button>

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
