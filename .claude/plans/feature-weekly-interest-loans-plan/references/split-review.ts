// Review of src/lib/money/split.ts (445 lines) — the canonical reference
// CONVENTIONS.md names: "Read this first. It carries the 7% = 5% + 2% invariant
// and the largest-remainder rule that stops a split losing centavos. Model any
// new money code on it."
//
// Only the parts src/lib/money/weekly.ts inherits from or must not contradict.

/**
 * The remainder rule the whole project turns on. Quoted in full because the
 * weekly schedule is a second remainder problem and had to decide whether to
 * reuse this or not.
 *
 * "₱8,400 does not always divide evenly. Flooring each share drops the
 *  remainders and the parts no longer sum to the whole; rounding each share
 *  independently can overshoot it. Largest-remainder does neither: floor
 *  everything, then give the leftover centavos one at a time to whoever was cut
 *  by the most.
 *
 *  Ties break by position, so the same loan always splits the same way. A split
 *  that shuffles its remainder between runs is a reconciliation bug waiting to
 *  happen, and an untestable one."
 */
function distribute(shares: Share[], total: Centavos, denominator: number): Map<string, Centavos> {
  // ... floors, then hands out `leftover` in descending-remainder order.
  // Throws rather than returning a Result when leftover is out of range:
  //   "This is a bug in the money module, not bad input."
}
// NOTE: weekly.ts does NOT reuse distribute, and the plan says why. Every week of
// a weekly loan is the same money on the same terms, so there is nothing to rank
// the weeks by — largest-remainder would scatter the leftover across arbitrary
// weeks. FEATURES.md §5 settles it: "the final week absorbs any remainder".
// weeklySlices is therefore equal parts plus a subtraction. Same guarantee (the
// parts sum to the whole), simpler rule, and it matches what the owner agreed.

/**
 * IMPORTANT — the rule the plan's §1.2 ordering is copied from. CONVENTIONS.md
 * states it as a trap: "Rounding a money split happens in ONE pass, never per
 * row."
 *
 * "Worked out here rather than by the caller, and that is the whole point.
 *  Rounding each row independently — principal x cut x weeks, rounded — gives a
 *  set of numbers that need not add up to `adminEarnings`, and the loan then
 *  fails to reconcile by a centavo or two with nothing to show why. These are
 *  carved out of the admin's total by the same largest-remainder rule, so they
 *  sum to it exactly, always."
 */
function adminCutPerRow(fundings: Funding[], weeks: number, adminEarnings: Centavos) {
  // Rows with a zero numerator are FILTERED OUT rather than given weight zero:
  //   "a zero-weight row can still win a leftover centavo on a tie, and a centavo
  //    of cut on the admin's own capital is a cut they are charging themselves."
  // NOTE: weekly.ts has the same hazard in miniature — a funder with zero
  // adminCut must not receive a centavo of it back through the weekly split.
  // weeklySlices(0, n) returns all zeros, so it cannot.
}

export function splitLoan(terms: LoanTerms): Result<Split, SplitError> {
  // The guarantee weekly.ts depends on, and never re-derives:
  //   sum(lenders[].earnings) + adminEarnings === totalInterest, exactly.
  // IMPORTANT: this is why slicing each funder's STORED earnings and defining a
  // week as the sum of its funder slices makes every week sum back to
  // Loan.interestCentavos. weekly.ts proves nothing about the split; it inherits it.
}

export type LenderShare = {
  lenderId: string
  principal: Centavos
  earnings: Centavos   // -> LoanFunding.earningsCentavos
  adminCut: Centavos   // -> LoanFunding.adminCutCentavos. Zero on the Admin's own row.
}
// NOTE: WeeklyFunder in the new module takes exactly these two money fields, read
// back off the stored rows. The shape is deliberate: it makes it obvious at a
// glance that no rate reaches the weekly arithmetic.

/**
 * Used unchanged by the loan screen, the summary report, the admin-cut report and
 * the Excel backup. The plan changes none of them.
 */
export function adminTakeOnLoan(
  fundings: { adminCut: Centavos; earnings: Centavos; isSelf: boolean }[],
): Centavos {
  return centavos(
    fundings.reduce((t, f) => t + f.adminCut + (f.isSelf ? f.earnings : 0), 0),
  )
}

/**
 * IMPORTANT — THE HIGH-SEVERITY ISSUE IN THE PLAN LIVES HERE.
 *
 * "the Admin's own capital in the loan (their principal, which comes back)
 *  + what that capital earned (their own funding rows' earnings)
 *  + the cut charged on everyone else (adminCut, which is 0 on their rows)"
 *
 * and, stated as a deliberate choice:
 *
 * "INTEREST IS IN THE CEILING EVEN THOUGH IT HAS NOT ARRIVED. That is the point
 *  of an advance: it is money drawn early against a return that is expected, not
 *  received."
 *
 * That reasoning holds only while NONE of the interest has arrived. On a weekly
 * loan part of it has, and is already in floating. The ceiling then counts the
 * same pesos twice and the Admin can draw them twice.
 *
 * The function itself is correct. getLoan (loans/queries.ts:~500) is the caller
 * that must subtract what has been released before passing `advanced`.
 *
 * Angel's live loan is funded 100% by the Admin's own pot, so this is live on
 * the exact loan the feature was built for.
 */
export function adminStakeInLoan(
  fundings: { principal: Centavos; adminCut: Centavos; earnings: Centavos; isSelf: boolean }[],
  advanced: Centavos,
): AdminStake {
  const stake = centavos(adminTakeOnLoan(fundings) + /* own principal */ 0)
  return { stake, advanced, headroom: centavos(Math.max(0, stake - advanced)) }
}
