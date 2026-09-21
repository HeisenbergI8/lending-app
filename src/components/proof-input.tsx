'use client'

import { useRef, useState } from 'react'
import { Paperclip, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
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
}: {
  name?: string
  label: string
  hint?: string
  className?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [chosen, setChosen] = useState<File[]>([])
  const [problem, setProblem] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  /** Put a list of files back on the input, since that is what the form submits. */
  const applyToInput = (files: File[]) => {
    if (!inputRef.current) return
    const transfer = new DataTransfer()
    for (const file of files) transfer.items.add(file)
    inputRef.current.files = transfer.files
  }

  const onChange = async () => {
    const picked = Array.from(inputRef.current?.files ?? [])
    if (picked.length === 0) {
      setChosen([])
      setProblem(null)
      return
    }

    setWorking(true)
    const processed = await Promise.all(picked.slice(0, MAX_PROOF_FILES).map(shrink))
    setWorking(false)

    const rejected = processed
      .map((file) => checkProofFile({ name: file.name, type: file.type, size: file.size }))
      .find((result) => !result.ok)

    if (rejected && !rejected.ok) {
      setProblem(rejected.error)
      setChosen([])
      applyToInput([])
      return
    }

    setProblem(null)
    setChosen(processed)
    applyToInput(processed)
  }

  const removeAt = (index: number) => {
    const kept = chosen.filter((_, position) => position !== index)
    setChosen(kept)
    applyToInput(kept)
  }

  return (
    <div className={cn('space-y-2', className)}>
      <Label htmlFor={name}>{label}</Label>

      <input
        ref={inputRef}
        id={name}
        name={name}
        type="file"
        multiple
        accept={PROOF_ACCEPT_ATTRIBUTE}
        onChange={onChange}
        className="file:bg-muted file:text-foreground hover:file:bg-muted/70 block min-h-11 w-full cursor-pointer text-sm file:mr-3 file:h-9 file:cursor-pointer file:rounded-lg file:border-0 file:px-3 file:text-sm file:font-medium pointer-fine:min-h-0 pointer-fine:file:h-auto pointer-fine:file:py-1.5"
      />

      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
      {working ? <p className="text-muted-foreground text-xs">Preparing files…</p> : null}
      {problem ? <p className="text-status-critical text-xs font-medium">{problem}</p> : null}

      {chosen.length > 0 ? (
        <ul className="space-y-1">
          {chosen.map((file, index) => (
            <li key={`${file.name}-${index}`} className="bg-muted/50 flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs">
              <Paperclip className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{file.name}</span>
              <span className="text-muted-foreground shrink-0">{describeBytes(file.size)}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="size-9 p-0 pointer-fine:h-6 pointer-fine:w-auto pointer-fine:px-1"
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
