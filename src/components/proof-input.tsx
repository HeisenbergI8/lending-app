'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { CircleAlert, FileText, ImagePlus, LoaderCircle, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  MAX_PROOF_BYTES,
  MAX_PROOF_FILES,
  PROOF_ACCEPT_ATTRIBUTE,
  checkProofFile,
  describeBytes,
  downscaleTo,
} from '@/lib/proof.ts'
import { cn } from '@/lib/utils'

/**
 * Choosing the screenshots that back a payment.
 *
 * Images are SHRUNK IN THE BROWSER before they are sent. Free Supabase storage
 * is small and a phone photo is several megabytes of detail nobody will look at;
 * a GCash receipt is perfectly legible at 1600px. Doing it here also keeps the
 * upload quick on a phone connection.
 *
 * Every step of that is best-effort. If the browser cannot decode the image —
 * HEIC is the common case — the original file is sent untouched rather than the
 * attachment failing. The server checks the type and size again either way.
 */

const QUALITY = 0.82

/** Shrink one image, or hand back exactly what came in. */
async function shrink(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file

  try {
    const bitmap = await createImageBitmap(file)
    const target = downscaleTo(bitmap.width, bitmap.height)
    if (!target) {
      bitmap.close()
      return file
    }

    const canvas = document.createElement('canvas')
    canvas.width = target.width
    canvas.height = target.height
    const context = canvas.getContext('2d')
    if (!context) return file

    context.drawImage(bitmap, 0, 0, target.width, target.height)
    bitmap.close()

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY))
    if (!blob || blob.size >= file.size) return file

    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' })
  } catch {
    // A format the browser will not decode. Send it as it came; the bucket does
    // not mind, and refusing here would lose a real receipt over a codec.
    return file
  }
}

export function ProofInput({
  name = 'proof',
  label,
  hint,
  className,
  required = false,
  onCountChange,
}: {
  name?: string
  label: string
  hint?: string
  className?: string
  /**
   * Nothing chosen stops the submit and flags THIS box, in place, rather than
   * the browser's bubble or an error at the foot of the form. The server
   * checks again either way.
   */
  required?: boolean
  /** Told how many files are chosen, so a form can keep its button off until there is one. */
  onCountChange?: (count: number) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLLabelElement>(null)
  const [chosen, setChosen] = useState<File[]>([])
  useEffect(() => onCountChange?.(chosen.length), [chosen, onCountChange])
  const [problem, setProblem] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)
  const [working, setWorking] = useState(false)
  const [dragging, setDragging] = useState(false)

  // A form reset (after a successful attach) empties the input, so the list of
  // picked files must empty with it. Checked a tick later: a form that cancels
  // its reset to keep what was typed (the loan form) keeps the list too.
  useEffect(() => {
    const form = inputRef.current?.form
    if (!form) return
    const onReset = (event: Event) =>
      setTimeout(() => {
        if (!event.defaultPrevented) setChosen([])
      })
    form.addEventListener('reset', onReset)
    return () => form.removeEventListener('reset', onReset)
  }, [])

  /** Put a list of files back on the input, since that is what the form submits. */
  const applyToInput = (files: File[]) => {
    if (!inputRef.current) return
    const transfer = new DataTransfer()
    for (const file of files) transfer.items.add(file)
    inputRef.current.files = transfer.files
  }

  /**
   * New picks are ADDED to what is already chosen, up to the limit. Picking
   * again used to replace the first choice, which is how a second screenshot
   * quietly lost the first.
   */
  const take = async (picked: File[]) => {
    if (picked.length === 0) {
      applyToInput(chosen)
      return
    }

    setWorking(true)
    const processed = await Promise.all(picked.map(shrink))
    setWorking(false)

    const rejected = processed
      .map((file) => checkProofFile({ name: file.name, type: file.type, size: file.size }))
      .find((result) => !result.ok)
    if (rejected && !rejected.ok) {
      setProblem(rejected.error)
      applyToInput(chosen)
      return
    }

    const next = [...chosen, ...processed]
    setProblem(next.length > MAX_PROOF_FILES ? `Only the first ${MAX_PROOF_FILES} files are kept.` : null)
    const kept = next.slice(0, MAX_PROOF_FILES)
    setMissing(false)
    setChosen(kept)
    applyToInput(kept)
  }

  const removeAt = (index: number) => {
    const kept = chosen.filter((_, position) => position !== index)
    setChosen(kept)
    applyToInput(kept)
  }

  const full = chosen.length >= MAX_PROOF_FILES

  return (
    <div className={cn('space-y-2.5', className)}>
      <Label htmlFor={name}>{label}</Label>

      <label
        ref={boxRef}
        htmlFor={name}
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          void take(Array.from(event.dataTransfer.files))
        }}
        data-missing={missing || undefined}
        className={cn(
          'group/drop border-border bg-muted/30 hover:border-brand-line hover:bg-brand-bg relative flex cursor-pointer items-center gap-3.5 rounded-xl border border-dashed p-3.5 transition-[background-color,border-color,box-shadow] duration-200',
          'has-[:focus-visible]:ring-ring/50 has-[:focus-visible]:ring-3',
          dragging && 'border-brand-line bg-brand-bg',
          missing && 'border-destructive/50 bg-destructive/[0.04] hover:border-destructive/60 hover:bg-destructive/[0.06]',
          full && 'pointer-events-none opacity-60',
        )}
      >
        <input
          ref={inputRef}
          id={name}
          name={name}
          type="file"
          multiple
          accept={PROOF_ACCEPT_ATTRIBUTE}
          required={required}
          disabled={full}
          onChange={() => void take(Array.from(inputRef.current?.files ?? []))}
          onInvalid={(event) => {
            // Our own message, on this box, in place of the browser's bubble.
            event.preventDefault()
            setMissing(true)
            boxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
          }}
          className="sr-only"
        />
        <span
          className={cn(
            'bg-card text-brand ring-border/70 flex size-11 shrink-0 items-center justify-center rounded-xl shadow-rest ring-1 transition-transform duration-200 group-hover/drop:-translate-y-0.5',
            missing && 'text-destructive ring-destructive/25',
          )}
        >
          {working ? <LoaderCircle className="size-5 animate-spin" aria-hidden /> : <ImagePlus className="size-5" aria-hidden />}
        </span>
        <span className="min-w-0 text-sm">
          <span className="block font-medium">
            {working ? 'Preparing…' : full ? `${MAX_PROOF_FILES} files is the limit` : chosen.length > 0 ? 'Add another' : 'Tap to add a screenshot'}
          </span>
          <span className="text-muted-foreground block text-xs">PNG, JPG, HEIC or PDF · up to {describeBytes(MAX_PROOF_BYTES)} each</span>
        </span>
      </label>

      {missing ? (
        <p className="text-destructive animate-in fade-in slide-in-from-top-1 flex items-center gap-1.5 text-xs font-medium" role="alert">
          <CircleAlert className="size-3.5 shrink-0" aria-hidden />
          Add a screenshot to continue.
        </p>
      ) : null}
      {problem ? (
        <p className="text-destructive flex items-center gap-1.5 text-xs font-medium" role="alert">
          <CircleAlert className="size-3.5 shrink-0" aria-hidden />
          {problem}
        </p>
      ) : null}
      {hint && !missing ? <p className="text-muted-foreground text-xs">{hint}</p> : null}

      {chosen.length > 0 ? (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {chosen.map((file, index) => (
            <li
              key={`${file.name}-${file.size}-${index}`}
              className="bg-muted ring-border/70 animate-in fade-in zoom-in-95 relative aspect-square overflow-hidden rounded-xl ring-1"
            >
              <Thumb file={file} />
              <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-2 pt-5 pb-1.5 text-[11px] font-medium text-white">
                {describeBytes(file.size)}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute top-1.5 right-1.5 size-7 rounded-full bg-black/55 p-0 text-white backdrop-blur hover:bg-black/70 hover:text-white"
                onClick={() => removeAt(index)}
              >
                <X className="size-3.5" aria-hidden />
                <span className="sr-only">Remove {file.name}</span>
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

/** A picked file, shown: the picture itself, or a document icon for a PDF. */
function Thumb({ file }: { file: File }) {
  const url = useMemo(() => (file.type.startsWith('image/') ? URL.createObjectURL(file) : null), [file])
  useEffect(() => () => (url ? URL.revokeObjectURL(url) : undefined), [url])

  if (!url) {
    return (
      <span className="text-muted-foreground flex size-full flex-col items-center justify-center gap-1 px-2 text-center text-[11px]">
        <FileText className="size-5" aria-hidden />
        <span className="w-full truncate">{file.name}</span>
      </span>
    )
  }
  // A blob URL, so a plain img: there is nothing for Next's optimizer to fetch.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={file.name} className="size-full object-cover" />
}
