'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Camera, ImageUp, LoaderCircle, Maximize2, Trash2, ZoomIn, ZoomOut } from 'lucide-react'

import { Avatar } from '@/components/avatar.tsx'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { NO_ERROR } from '@/lib/form-state.ts'
import { withSound } from '@/lib/sound.ts'
import { cn } from '@/lib/utils'
import { clearBorrowerPhoto, setBorrowerPhoto } from '@/server/borrowers/actions.ts'

import { PhotoViewer } from './photo-viewer.tsx'

/**
 * A borrower's photo, with the ways to see, set, crop or remove it.
 *
 * TAPPING THE PHOTO OPENS IT FULL SCREEN (photo-viewer.tsx), at the Admin's
 * request (2026-09-30); the camera badge on its corner holds Change and
 * Remove. With no photo, tapping the circle adds one.
 *
 * CROPPED ON THE PHONE, NOT THE SERVER. Picking a photo opens a crop step: the
 * Admin drags it and zooms until the face sits in the circle, and only that
 * square leaves the device, redrawn at 512px as a JPEG. A camera photo of
 * several megabytes becomes tens of kilobytes, and the same format whatever the
 * camera produced (the browser converts HEIC on the way in). The whole photo
 * goes too, at most 1600px on its long side, for the full-screen view only —
 * no list ever loads it.
 *
 * The crop is held as a zoom and a centre point IN THE PHOTO'S OWN PIXELS, not
 * as an offset on screen. That way the preview and the saved file are the same
 * sum, and the preview can size itself to the phone without either changing.
 */

const SIZE = 512
const MAX_ZOOM = 4
/** The whole photo, for the full-screen view, is kept at most this long on its long side. */
const FULL_LONG_SIDE = 1600

type Crop = { zoom: number; x: number; y: number }
type Picked = { url: string; width: number; height: number }

/** Keep the circle filled: the centre can go no nearer an edge than half the visible square. */
function clamp(crop: Crop, picked: Picked): Crop {
  const zoom = Math.min(MAX_ZOOM, Math.max(1, crop.zoom))
  const half = Math.min(picked.width, picked.height) / (2 * zoom)
  return {
    zoom,
    x: Math.min(picked.width - half, Math.max(half, crop.x)),
    y: Math.min(picked.height - half, Math.max(half, crop.y)),
  }
}

async function croppedJpeg(file: File, crop: Crop): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const side = Math.min(bitmap.width, bitmap.height) / crop.zoom
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const context = canvas.getContext('2d')
  if (!context) throw new Error('no canvas')
  context.imageSmoothingQuality = 'high'
  context.drawImage(bitmap, crop.x - side / 2, crop.y - side / 2, side, side, 0, 0, SIZE, SIZE)
  bitmap.close()
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('no blob'))), 'image/jpeg', 0.88),
  )
}

/**
 * The WHOLE photo, uncropped, for the full-screen view (photo-viewer.tsx). The
 * crop above only decides the circle; the viewer shows what was taken.
 */
async function fullJpeg(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, FULL_LONG_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('no canvas')
  context.imageSmoothingQuality = 'high'
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('no blob'))), 'image/jpeg', 0.85),
  )
}

/**
 * The square the photo is framed in, with the circle it will be shown as.
 *
 * Drag moves it, a pinch or the mouse wheel zooms it, and the arrow keys and
 * + / - do the same for a keyboard. Everything outside the circle is dimmed
 * rather than hidden, so the Admin can see what is about to be cut off.
 */
function CropStage({
  picked,
  crop,
  onChange,
}: {
  picked: Picked
  crop: Crop
  onChange: (next: (crop: Crop) => Crop) => void
}) {
  const stage = useRef<HTMLDivElement>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const [dragging, setDragging] = useState(false)

  const short = Math.min(picked.width, picked.height)
  /** Photo pixels per screen pixel, at the current zoom. */
  const perPixel = () => short / (crop.zoom * (stage.current?.clientWidth || 1))

  // A wheel listener has to be registered by hand to be allowed to stop the
  // page scrolling underneath; React's onWheel is passive.
  useEffect(() => {
    const element = stage.current
    if (!element) return
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      onChange((current) => ({ ...current, zoom: current.zoom * Math.exp(-event.deltaY * 0.002) }))
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [onChange])

  const move = (event: React.PointerEvent) => {
    const last = pointers.current.get(event.pointerId)
    if (!last) return
    const now = { x: event.clientX, y: event.clientY }

    if (pointers.current.size === 2) {
      // Two fingers: the change in the gap between them is the zoom.
      const [a, b] = [...pointers.current.values()]
      const other = a === last ? b : a
      const before = Math.hypot(last.x - other.x, last.y - other.y)
      const after = Math.hypot(now.x - other.x, now.y - other.y)
      if (before > 0) onChange((current) => ({ ...current, zoom: current.zoom * (after / before) }))
    } else {
      const scale = perPixel()
      const dx = now.x - last.x
      const dy = now.y - last.y
      onChange((current) => ({ ...current, x: current.x - dx * scale, y: current.y - dy * scale }))
    }
    pointers.current.set(event.pointerId, now)
  }

  const release = (event: React.PointerEvent) => {
    pointers.current.delete(event.pointerId)
    if (pointers.current.size === 0) setDragging(false)
  }

  const key = (event: React.KeyboardEvent) => {
    const step = 10 * perPixel()
    const moves: Record<string, (current: Crop) => Crop> = {
      ArrowLeft: (current) => ({ ...current, x: current.x - step }),
      ArrowRight: (current) => ({ ...current, x: current.x + step }),
      ArrowUp: (current) => ({ ...current, y: current.y - step }),
      ArrowDown: (current) => ({ ...current, y: current.y + step }),
      '+': (current) => ({ ...current, zoom: current.zoom * 1.1 }),
      '=': (current) => ({ ...current, zoom: current.zoom * 1.1 }),
      '-': (current) => ({ ...current, zoom: current.zoom / 1.1 }),
    }
    const change = moves[event.key]
    if (!change) return
    event.preventDefault()
    onChange(change)
  }

  // As fractions of the square, so the preview needs no measuring to draw.
  const across = crop.zoom / short
  const style = {
    width: `${picked.width * across * 100}%`,
    height: `${picked.height * across * 100}%`,
    left: `${(0.5 - crop.x * across) * 100}%`,
    top: `${(0.5 - crop.y * across) * 100}%`,
  }

  return (
    <div
      ref={stage}
      tabIndex={0}
      role="application"
      aria-label="Photo crop. Drag to move, pinch or scroll to zoom. Arrow keys move it, plus and minus zoom."
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
        setDragging(true)
      }}
      onPointerMove={move}
      onPointerUp={release}
      onPointerCancel={release}
      onKeyDown={key}
      className={cn(
        'bg-muted focus-visible:ring-ring/50 relative mx-auto aspect-square w-full max-w-72 touch-none overflow-hidden rounded-2xl select-none focus-visible:ring-3 focus-visible:outline-none',
        dragging ? 'cursor-grabbing' : 'cursor-grab',
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- a local blob preview; there is nothing for Next to optimise */}
      <img src={picked.url} alt="" draggable={false} className="pointer-events-none absolute max-w-none" style={style} />
      {/* The circle the photo will be shown in. The huge shadow is the dimming
          outside it, which keeps it a perfect circle at any size. */}
      <div className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_9999px_rgb(0_0_0/0.55)] ring-2 ring-white/80" />
    </div>
  )
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
  /** The whole picture for the full-screen view; null for a photo saved before it existed. */
  full: string | null
}) {
  const router = useRouter()
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [picked, setPicked] = useState<Picked | null>(null)
  const [crop, setCrop] = useState<Crop>({ zoom: 1, x: 0, y: 0 })
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [saving, startSaving] = useTransition()
  const [removing, startRemoving] = useTransition()
  const [error, setError] = useState('')
  const [pageError, setPageError] = useState('')

  const pending = saving || removing
  const choose = () => input.current?.click()

  // One object link per picked photo, let go of when it is replaced or closed.
  const url = picked?.url
  useEffect(() => () => (url ? URL.revokeObjectURL(url) : undefined), [url])

  const updateCrop = useCallback(
    (next: (crop: Crop) => Crop) => setCrop((current) => (picked ? clamp(next(current), picked) : current)),
    [picked],
  )

  const pick = (chosen: File | undefined) => {
    // The same file can be picked again after a cancel or a failure.
    if (input.current) input.current.value = ''
    if (!chosen) return
    setError('')
    setPageError('')
    const link = URL.createObjectURL(chosen)
    const image = new Image()
    image.onload = () => {
      const width = image.naturalWidth
      const height = image.naturalHeight
      setFile(chosen)
      setPicked({ url: link, width, height })
      setCrop({ zoom: 1, x: width / 2, y: height / 2 })
    }
    image.onerror = () => {
      URL.revokeObjectURL(link)
      setPageError('That file could not be opened as a photo. Try another.')
    }
    image.src = link
  }

  const close = () => {
    setPicked(null)
    setFile(null)
    setError('')
  }

  const save = () => {
    if (!file) return
    setError('')
    startSaving(async () => {
      try {
        const form = new FormData()
        form.set('borrowerId', borrowerId)
        form.set('photo', new File([await croppedJpeg(file, crop)], 'photo.jpg', { type: 'image/jpeg' }))
        form.set('full', new File([await fullJpeg(file)], 'full.jpg', { type: 'image/jpeg' }))
        const result = await withSound(setBorrowerPhoto, 'save')(NO_ERROR, form)
        if (result.error) return setError(result.error)
        close()
        router.refresh()
      } catch {
        setError('That photo could not be read. Try another.')
      }
    })
  }

  const remove = () => {
    setPageError('')
    startRemoving(async () => {
      const form = new FormData()
      form.set('borrowerId', borrowerId)
      const result = await withSound(clearBorrowerPhoto, 'trash')(NO_ERROR, form)
      if (result.error) return setPageError(result.error)
      router.refresh()
    })
  }

  /* THE CIRCLE. With a photo, tapping it opens the photo full screen and
     the camera badge in the corner opens Change / Remove; without one, the
     whole circle is the way to add one. The badge is a sibling of the circle,
     never inside it, so each is its own button. */
  const face = (icon: typeof Camera) => {
    const Icon = icon
    return (
      <span className="group relative block rounded-full">
        <Avatar name={name} photo={photo} className="size-20 text-xl sm:size-24 sm:text-2xl" />
        {/* A dark veil on hover says what a tap does, on a laptop; on a phone
            the badge in the corner says it. */}
        <span
          className={cn(
            'absolute inset-0 flex items-center justify-center rounded-full bg-black/45 text-white transition-opacity',
            pending ? 'opacity-100' : 'opacity-0 pointer-fine:group-hover:opacity-100',
          )}
        >
          {pending ? <LoaderCircle className="size-6 animate-spin" aria-hidden /> : <Icon className="size-6" aria-hidden />}
        </span>
      </span>
    )
  }

  const badge =
    'bg-primary text-primary-foreground ring-background absolute right-0 bottom-0 flex size-7 items-center justify-center rounded-full ring-3'
  const trigger = 'focus-visible:ring-ring/50 shrink-0 cursor-pointer rounded-full focus-visible:ring-3 focus-visible:outline-none disabled:cursor-default'

  return (
    <div className="flex flex-col items-start gap-1">
      {photo ? (
        <div className="relative shrink-0">
          <PhotoViewer name={name} square={photo} full={full}>
            <button type="button" aria-label={`View ${name}’s photo`} className={cn(trigger, 'cursor-zoom-in')}>
              {face(Maximize2)}
            </button>
          </PhotoViewer>
          <DropdownMenu>
            <DropdownMenuTrigger asChild disabled={pending}>
              {/* A 44px target around the 28px badge, for a thumb. */}
              <button
                type="button"
                aria-label={`Change or remove ${name}’s photo`}
                className="focus-visible:ring-ring/50 absolute -right-2 -bottom-2 flex size-11 cursor-pointer items-end justify-end rounded-full focus-visible:ring-3 focus-visible:outline-none"
              >
                <span className={cn(badge, 'right-2 bottom-2')}>
                  <Camera className="size-3.5" aria-hidden />
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-44">
              <DropdownMenuItem onSelect={choose}>
                <ImageUp aria-hidden />
                Change photo
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setConfirmRemove(true)}>
                <Trash2 aria-hidden />
                Remove photo
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : (
        <button type="button" onClick={choose} disabled={pending} aria-label={`Add a photo of ${name}`} className={cn(trigger, 'relative')}>
          {face(Camera)}
          <span className={badge}>
            <Camera className="size-3.5" aria-hidden />
          </span>
        </button>
      )}

      {pageError ? (
        <p className="text-destructive max-w-40 text-xs" role="alert">
          {pageError}
        </p>
      ) : null}

      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => pick(event.target.files?.[0])}
      />

      <Dialog open={picked !== null} onOpenChange={(open) => (open || saving ? undefined : close())}>
        <DialogContent className="max-w-sm">
          <DialogTitle>{photo ? 'Change photo' : 'Add photo'}</DialogTitle>
          <DialogDescription>Drag to move it and zoom until the face fills the circle.</DialogDescription>

          {picked ? (
            <div className="mt-4 space-y-4">
              <CropStage picked={picked} crop={crop} onChange={updateCrop} />

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => updateCrop((current) => ({ ...current, zoom: current.zoom / 1.25 }))}
                  className="text-muted-foreground hover:text-foreground cursor-pointer p-1"
                  aria-label="Zoom out"
                >
                  <ZoomOut className="size-4" aria-hidden />
                </button>
                <input
                  type="range"
                  min={1}
                  max={MAX_ZOOM}
                  step={0.01}
                  value={crop.zoom}
                  onChange={(event) => updateCrop((current) => ({ ...current, zoom: Number(event.target.value) }))}
                  aria-label="Zoom"
                  className="accent-primary h-1.5 flex-1 cursor-pointer"
                />
                <button
                  type="button"
                  onClick={() => updateCrop((current) => ({ ...current, zoom: current.zoom * 1.25 }))}
                  className="text-muted-foreground hover:text-foreground cursor-pointer p-1"
                  aria-label="Zoom in"
                >
                  <ZoomIn className="size-4" aria-hidden />
                </button>
              </div>

              {error ? (
                <Alert variant="destructive" role="alert">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
                <Button type="button" variant="ghost" onClick={choose} disabled={saving} className="w-full sm:mr-auto sm:w-auto">
                  Pick another
                </Button>
                <DialogClose asChild>
                  <Button type="button" variant="ghost" disabled={saving} className="w-full sm:w-auto">
                    Cancel
                  </Button>
                </DialogClose>
                <Button type="button" onClick={save} disabled={saving} className="w-full sm:w-auto">
                  {saving ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
                  {saving ? 'Saving…' : 'Save photo'}
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogTitle>Remove this photo?</AlertDialogTitle>
          <AlertDialogDescription>Their initials show in its place. A new photo can be added at any time.</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={remove}>
              Remove photo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
