import { FileText, ImageIcon } from 'lucide-react'

import { ActionForm } from '@/components/forms.tsx'
import { ProofPreview } from '@/components/proof-preview.tsx'
import { describeBytes } from '@/lib/proof.ts'
import type { ProofFileView } from '@/server/payments/queries.ts'

/** Proof files with a preview and a Remove button each — shared by payments and the money sent. */
export function ProofList({
  files,
  remove,
  field,
  removeBody,
}: {
  files: ProofFileView[]
  /** Omitted when the file cannot be removed — the only screenshot of the money sent. */
  remove?: React.ComponentProps<typeof ActionForm>['action']
  field: string
  removeBody: string
}) {
  if (files.length === 0) return null
  return (
    <ul className="space-y-2">
      {files.map((file, index) => (
        <li key={file.id} className="flex items-center gap-3 rounded-lg border p-2.5">
          {file.url && !file.isPdf ? (
            <ProofPreview
              url={file.url}
              label={`Screenshot ${index + 1}`}
              meta={describeBytes(file.sizeBytes)}
            />
          ) : (
            <>
              <span className="bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-lg">
                {file.isPdf ? <FileText className="size-4" aria-hidden /> : <ImageIcon className="size-4" aria-hidden />}
              </span>

              <div className="min-w-0 flex-1 text-sm">
                {file.url ? (
                  // Signed, and good for a few minutes only — the bucket is
                  // private, so there is no lasting address to leak.
                  <a href={file.url} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">
                    Document {index + 1}
                  </a>
                ) : (
                  <span className="text-muted-foreground font-medium">
                    {file.isPdf ? 'Document' : 'Screenshot'} {index + 1} · link unavailable
                  </span>
                )}
                <div className="text-muted-foreground text-xs">{describeBytes(file.sizeBytes)}</div>
              </div>
            </>
          )}

          {remove ? (
            <ActionForm
              action={remove}
              sound="trash"
              values={{ [field]: file.id }}
              variant="ghost"
              size="sm"
              pendingLabel="Removing…"
              confirm={{
                title: 'Remove this file?',
                body: removeBody,
                action: 'Remove file',
              }}
            >
              Remove
            </ActionForm>
          ) : null}
        </li>
      ))}
    </ul>
  )
}
