// Review of src/app/(app)/loans/[id]/payment-panel.tsx — the pattern the week
// panel copies, including the one decision that is easy to get backwards.

/**
 * "THE AMOUNT IS NOT A FIELD. Full payment only — the borrower hands over the
 *  whole total, which was fixed the day the loan was created. Showing it as an
 *  editable number would invite a partial payment the rest of the app has no way
 *  to represent."
 *
 * NOTE: the week panel follows this exactly, and gains a second one — the WEEK is
 * not a field either. It is whichever is earliest unpaid, so it cannot skip a
 * week that is still owed. FEATURES.md §5: one week at a time, no paying ahead.
 */

// ---- IMPORTANT: the trap CONVENTIONS.md names, and this file is the worked
//      example of getting it RIGHT ---------------------------------------
/**
 * "Wrapping a server action in a closure costs the form its no-JavaScript
 *  fallback. Next can only post a form straight to the server when the function
 *  handed to useActionState IS the server action ... MarkPaidPanel is the worked
 *  example of leaving one unwrapped on purpose."
 */
export function MarkPaidPanel({ loanId, total }: { loanId: string; total: string }) {
  // "markPaid itself, not a wrapper: this form is rendered server-side and posts
  //  without JavaScript. Nothing needs clearing afterwards — on success the whole
  //  section is replaced by the payment that was just recorded."
  const [state, formAction] = useActionState(markPaid, NO_ERROR)
  // ...
}
// The week panel is the same case: nothing to clear, the row is replaced on
// success. It must be left unwrapped. An implementer who copies the wrapped
// AddProofForm below by mistake silently costs the app a fallback.

function useClearOnSuccess(action) {
  // The wrapped one, and its justification for being the exception:
  // "That is an acceptable trade HERE and nowhere else on this page: choosing
  //  files, shrinking them and showing what was picked all need JavaScript
  //  anyway, so there was no fallback to lose."
  //
  // "Clearing happens in the submit rather than in an effect watching the result:
  //  the form clears BECAUSE something was saved, and saying so here is both
  //  simpler and what the React compiler's rules ask for."
}

// ---- The proof wording, reused verbatim ----------------------------------
<ProofInput
  label="Proof of payment"
  hint="Optional. The screenshot, the chat, or both. They can be added later."
/>
// NOTE: no "you", no em dash. The house style holds in every string on this page:
//   "Records the full ₱38,400. There are no partial payments."
//   "Images are shrunk before they are stored."
// The week panel's "Records week 7, ₱4,200. The capital stays out on loan."
// follows the same shape: what it does, then the thing worth knowing.

// ---- today() -------------------------------------------------------------
function today(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-...`
}
// NOTE: built by hand rather than through toDateInput() from money/weeks.ts,
// which does exactly this. A client component may import from src/lib/, so the
// duplication is avoidable. Not this feature's to fix, but the week panel should
// use toDateInput rather than copy this.

// QUESTION: the conversion form needs ONE DATE PER TICKED WEEK, up to nineteen
// date inputs on one form. Nothing in this app has a repeating-row form except
// the funder rows on loan-form.tsx, which is the pattern to look at (getAll()
// over a repeated field name, indices lining up). Worth reading before building.
