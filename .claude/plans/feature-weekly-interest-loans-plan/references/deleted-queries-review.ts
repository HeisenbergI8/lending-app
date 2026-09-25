// Review of src/server/deleted/queries.ts (232 lines) — Recently Deleted.

/** The four sections. PAYMENTS ARE NOT ONE OF THEM, and that is the finding. */
export type DeletedSection = 'lenders' | 'borrowers' | 'loans' | 'transactions'

// IMPORTANT: an undone repayment is soft-deleted and appears NOWHERE on this
// screen. It simply vanishes and the loan reads Active again. FEATURES.md §11
// says "any record can be deleted for any reason, and restored whole within
// thirty days", but the app has never treated a payment that way — undo is the
// restore, and it is on the loan page.
//
// So an undone WEEK inherits that behaviour for free, and the plan recommends
// leaving it there (Option A in Step 7.3) rather than giving weekly payments a
// fifth section that ordinary payments do not have. If the owner wants Option B
// it should apply to both kinds of payment, as separate work.

// ---- What the screen is for, in its own words ----------------------------
// "Deleting in this app sets `deletedAt` and the default queries stop returning
//  the row. This is the only screen that asks for the opposite, so it is the only
//  place a `{ not: null }` filter belongs."
//
// "The deleted DATE comes back with every row: the countdown to the thirty-day
//  purge is half of what this screen is for."

// ---- The `held` rule, which a weekly loan does not change ----------------
_count: { select: { fundings: { where: { loan: { deletedAt: null } } } } }
// "Only rows that SURVIVE the purge hold: a funding row on a loan that is itself
//  in the bin dies in the same run, so counting it would promise a hold that does
//  not exist and suppress the countdown."
// NOTE: a deleted weekly loan takes its twenty payments with it by cascade, so
// nothing here has to count them.

// ---- isEmpty, and the habit worth copying --------------------------------
export function isEmpty(deleted: Deleted): boolean {
  return DELETED_SECTIONS.every((section) => deleted.counts[section] === 0)
}
// "Counted from `counts`, never from the rendered arrays: on page 2 of a list
//  that just shrank, every array is empty while the bin is not, and telling
//  somebody their bin is empty when it is not is the one mistake this screen must
//  never make."
// NOTE: the same instinct as label-truth. If a fifth section is ever added, its
// count must be a `count` query and not an array length.

// ---- deletedOn(), the narrowing done once --------------------------------
// "The WHERE clause said deletedAt is not null; the type does not know that. One
//  place asserts it, right where the guarantee is made, instead of a
//  `?? new Date()` at every call site quietly inventing a deletion date that
//  would then be counted down from."
// NOTE: the same shape as the settlingPayment helper the plan extracts — narrow
// once, where the guarantee is made. Worth pointing at as precedent.
