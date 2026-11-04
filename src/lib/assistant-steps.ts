/**
 * What Dex-E is doing, in the Admin's words, one line per lookup: "Looking for
 * Angel…" while it runs, then "Found Angel Dela Cruz". Built from the tool's
 * name, what it was asked and what it found, never from the AI's own text, so
 * the steps cost no tokens and say only what really happened.
 *
 * Pure, so every line can be tested without a database or a model.
 */

/** doing: still running. done: found what it looked for. missed: looked and found nothing. */
export type StepState = 'doing' | 'done' | 'missed'
export type Step = { id: number; text: string; state: StepState }

type Args = Record<string, unknown>
type Found = Record<string, unknown> | null

/** "angel dela cruz" → "Angel Dela Cruz", cut short so a line never wraps twice. */
function nameOf(value: unknown): string {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, 40)
  return text.replace(/\b\p{Ll}/gu, (c) => c.toUpperCase())
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const names = (value: unknown) => list(value).map((v) => (typeof v === 'string' ? v : String((v as { name?: unknown })?.name ?? '')))

/** The line shown while a lookup runs. */
export function stepStarted(tool: string, args: Args): string {
  switch (tool) {
    case 'read_rules':
      return 'Checking your rules'
    case 'get_overview':
      return 'Looking at your dashboard totals'
    case 'list_lenders':
      return 'Looking at your lenders'
    case 'find_borrower':
      return args.name ? `Looking for ${nameOf(args.name)}` : 'Looking for the borrower'
    case 'find_loans': {
      if (args.name) return `Looking at ${nameOf(args.name)}’s loans`
      if (args.status === 'overdue') return 'Looking for overdue loans'
      if (args.status === 'week') return 'Looking at loans due this week'
      if (args.status === 'paid') return 'Looking at paid loans'
      return 'Looking through your loans'
    }
    case 'get_loan':
      return 'Opening the loan'
    case 'get_lender':
      return args.name ? `Opening ${nameOf(args.name)}’s lender page` : 'Opening the lender page'
    case 'lender_earnings':
      return args.name ? `Adding up ${nameOf(args.name)}'s earnings` : 'Adding up the earnings'
    case 'period_summary':
      return 'Adding up loans and payments for those dates'
    case 'admin_cut':
      return "Adding up the Admin's cut"
    case 'borrower_statement':
      return args.name ? `Reading ${nameOf(args.name)}'s statement` : "Reading the borrower's statement"
    case 'money_history':
      return args.name ? `Reading ${nameOf(args.name)}'s money history` : 'Reading the money history'
    case 'floating_on':
      return 'Working out what will be floating'
    case 'list_pending':
      return 'Checking pending loan requests'
    case 'list_deleted':
      return 'Checking Recently Deleted'
    case 'find_action':
      return 'Working out what you want to change'
    case 'propose_action':
      return 'Getting the change ready for you to check'
    case 'search_notes':
      return args.text ? `Searching your notes for “${String(args.text).slice(0, 30)}”` : 'Searching your notes'
    default:
      return 'Looking it up'
  }
}

/** The line once the lookup is back, and whether it found what it looked for. */
export function stepFinished(tool: string, args: Args, result: unknown): { text: string; state: StepState } {
  const r: Found = result && typeof result === 'object' ? (result as Record<string, unknown>) : null
  const done = (text: string) => ({ text, state: 'done' as const })
  const missed = (text: string) => ({ text, state: 'missed' as const })
  const typed = nameOf(args.name)

  if (!r) return missed('Could not look that up')
  if (r.error && tool !== 'propose_action') return missed('Could not look that up')
  switch (tool) {
    case 'read_rules':
      return done('Checked your rules')
    case 'get_overview':
      return done('Checked your dashboard totals')
    case 'list_lenders':
      return done('Checked your lenders')
    case 'find_borrower': {
      if (r.found && r.tooMany) return missed(`Many people match “${typed}”`)
      const found = names(r.borrowers)
      if (found.length === 1) return done(`Found ${found[0]}`)
      if (found.length > 1) return done(`Found ${plural(found.length, 'person', 'people')}: ${found.join(', ')}`)
      if (list(r.lenders).length > 0) return done(`${names(r.lenders)[0]} is a lender, not a borrower`)
      if (list(r.deleted).length > 0) return missed(`${names(r.deleted)[0]} is in Recently Deleted`)
      if (list(r.didYouMean).length > 0) return missed(`No exact match for “${typed}”`)
      return missed(typed ? `Nobody named “${typed}”` : 'No borrower found')
    }
    case 'find_loans': {
      if (list(r.didYouMean).length > 0) return missed(`No loans for “${typed}”`)
      const total = Number((r.totals as { matching?: unknown } | undefined)?.matching ?? list(r.loans).length)
      return total > 0 ? done(`Found ${plural(total, 'loan')}`) : missed('No loans match')
    }
    case 'get_loan':
      return r.found ? done(`Opened ${r.borrower}’s ${r.amount} loan`) : missed('Could not find that loan')
    case 'get_lender':
      if (r.found) return done(`Opened ${r.name}’s lender page`)
      if (list(r.matches).length > 0) return missed(`Several lenders match “${typed}”`)
      return missed(`No lender named “${typed}”`)
    case 'lender_earnings':
      return r.found ? done(`Added up ${r.name}'s earnings`) : missed(`No lender named “${typed}”`)
    case 'period_summary':
      return done('Added up loans and payments')
    case 'admin_cut':
      return done("Added up the Admin's cut")
    case 'borrower_statement':
      return r.found ? done(`Read ${r.name}'s statement`) : missed(`No borrower named “${typed}”`)
    case 'money_history':
      return r.found ? done(`Read ${plural(Number(r.count ?? 0), 'money entry', 'money entries')}`) : missed(`No lender named “${typed}”`)
    case 'floating_on':
      return r.found ? done('Worked out what will be floating') : missed(`No lender named “${typed}”`)
    case 'list_pending': {
      const n = list(result).length
      return done(n > 0 ? `Found ${plural(n, 'pending request')}` : 'No pending requests')
    }
    case 'list_deleted':
      return done('Checked Recently Deleted')
    case 'find_action':
      return list(r.actions).length > 0 ? done('Worked out what to change') : missed('Not sure what to change yet')
    case 'propose_action':
      return r.proposal ? done('Change ready for you to check') : missed('A detail was off, checking again')
    case 'search_notes': {
      const n = list(r.notes).length
      return n > 0 ? done(`Found ${plural(n, 'note')}`) : missed('No notes match')
    }
    default:
      return r.error ? missed('Could not look that up') : done('Looked it up')
  }
}
