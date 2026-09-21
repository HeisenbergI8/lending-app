import { CircleAlert, CircleCheck, CircleMinus } from 'lucide-react'

import { type TrackRecord, describeTrackRecord } from '@/lib/track-record.ts'
import { cn } from '@/lib/utils'

/**
 * How a borrower is doing, shown next to their name in the list — not buried on
 * the profile, because the point of a rating is to be seen before you lend.
 *
 * TWO THINGS, always together. The counted record is the app's arithmetic;
 * the label is the admin's own judgement, and it knows things the loans cannot
 * show — she is family, he always warns me first. Neither is a substitute for
 * the other, so neither is shown alone.
 *
 * The label's colours are NOT the loan-state palette. Those four tokens mean
 * loan state and nothing else; borrowing one for an opinion about a person would
 * make "Bad" read as "overdue". This uses the neutral chrome instead, and like
 * every badge here it carries an icon and a word, never colour alone.
 */

export type BorrowerLabelValue = 'GOOD' | 'OKAY' | 'BAD'

const LABEL: Record<BorrowerLabelValue, { text: string; icon: typeof CircleCheck; className: string }> = {
  GOOD: { text: 'Good', icon: CircleCheck, className: 'border-foreground/20 text-foreground' },
  OKAY: { text: 'Okay', icon: CircleMinus, className: 'border-border text-muted-foreground' },
  BAD: { text: 'Bad', icon: CircleAlert, className: 'border-foreground/30 text-foreground font-semibold' },
}

export function BorrowerLabelBadge({
  label,
  className,
}: {
  label: BorrowerLabelValue
  className?: string
}) {
  const { text, icon: Icon, className: tone } = LABEL[label]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs whitespace-nowrap',
        tone,
        className,
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {text}
    </span>
  )
}

/** "5 loans · 5 paid on time · 0 late" — counted, never typed in. */
export function TrackRecordLine({
  record,
  className,
}: {
  record: TrackRecord
  className?: string
}) {
  return (
    <span className={cn('text-muted-foreground text-xs', className)}>
      {describeTrackRecord(record)}
    </span>
  )
}
