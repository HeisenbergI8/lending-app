// Review of src/server/loans/terms.ts (281 lines) — where every loan figure is
// decided and every Admin-facing refusal is worded.

/**
 * "Pure — no database, no Next.js, no request. It takes what the admin typed and
 *  either returns every figure the loan needs or says, in words meant for a
 *  person, which part does not work.
 *
 *  It is separate from the action that writes the row so that the whole of the
 *  loan's arithmetic can be tested without a database, and so the form and the
 *  server cannot disagree about what a set of inputs means — both go through here."
 *
 * IMPORTANT: this is the file the two new refusals belong in, and it is why the
 * plan puts the collection flag on LoanInput rather than reading it in actions.ts.
 */

export const DEFAULT_BORROWER_RATE_BPS = 700
export const DEFAULT_ADMIN_CUT_BPS = 200

// The discriminated union, and the reasoning that says InterestCollection must be
// a separate field rather than a third arm of it:
//
//   "A discriminated union rather than every field on one object, because the two
//    halves are not both meaningful at once: a fixed-amount loan has no weekly
//    rate, and storing 0 for it would render as '0% a week' on the loan page."
//
// NOTE: weekly COLLECTION is meaningful alongside a weekly RATE and meaningless
// alongside a fixed amount — which is an orthogonal flag with one illegal
// combination, not a third arm. FEATURES.md §5 says the same in words: "This is
// not a third interest basis."
export type InterestInput =
  | { basis: 'WEEKLY_RATE'; borrowerRateBps: BasisPoints; adminCutBps: BasisPoints }
  | { basis: 'FIXED_AMOUNT'; interest: Centavos; lenderInterest: Centavos }

export type LoanTermsResult = {
  termDays: number      // "The term in DAYS, for every loan. Weeks are derived
                        //  from it ... storing both would be two columns that can
                        //  disagree."
  interest: Centavos
  total: Centavos
  split: Split
  fundings: FundingTerms[]
}
// NOTE: the plan adds nextDueOn here rather than computing it in actions.ts, so
// the one rule deciding it sits beside the one deciding termDays — two answers
// about the same pair of dates, from the same place.

function weeklyRateTerms(input, rates): Result<LoanTermsResult, string> {
  const weeks = weeksBetween(startOn, dueOn)
  if (!weeks.ok) return err(describeWeeksError(weeks.error))
  // IMPORTANT: this is the only place that proves termDays is a multiple of 7,
  // which is what lets weeklySchedule take a week count at all. The MIN_WEEKLY
  // check belongs immediately after it, where `weeks.value` is in hand.
}

function fixedAmountTerms(input, amounts): Result<LoanTermsResult, string> {
  const termDays = termDaysBetween(startOn, dueOn)   // no whole-week rule
  // IMPORTANT: the WEEKLY refusal must be the FIRST thing in this function, before
  // the dates are even read. A fixed-amount loan can be 3 days, and letting it
  // through to a schedule would mean termDays / 7 = 0.43.
}

// The refusal sentences, and the house style the two new ones must match. All say
// what is wrong and what to do; none says "you"; none uses an em dash.
'Enter a capital amount greater than zero.'
'Say whose money is funding this loan.'
'The Admin cut cannot be larger than what the borrower is charged.'
'The lender rate and the Admin cut must add up to the borrower rate.'
"Every peso of this loan is the Admin pot, so leave the lenders' share empty."
'The funding is ₱1,200.00 short of the capital.'
// NOTE: the last one names the exact shortfall rather than saying "does not
// match" — the same instinct behind describeWeeksError naming the two valid dates.
// The proposed "A loan collected weekly runs at least two weeks. This one is one
// week." follows it by naming what the loan actually is.

// The Admin-is-not-a-special-case rule, which the weekly schedule inherits by
// reading the stored rows rather than branching:
//
//   "THE ADMIN IS NOT A SPECIAL CASE. Their own capital earns the full borrower
//    rate and pays a cut of zero; a lender's earns the borrower rate less the cut.
//    Both come out of the same two lines."
function ratesFor(funder, borrowerRateBps, adminCutBps) {
  return {
    lenderRateBps: funder.isSelf ? borrowerRateBps : borrowerRateBps - adminCutBps,
    adminCutBps: funder.isSelf ? 0 : adminCutBps,
  }
}
// IMPORTANT for Angel's loan specifically: it is funded 100% by the Admin's own
// pot, so lenderRateBps = 700 and adminCutBps = 0 on its single funding row.
// weeklySlices(adminCut = 0, 20) returns twenty zeros and the whole week goes to
// the Admin's own earnings. The "lender keeps ₱3,000, Admin takes ₱1,200" split in
// FEATURES.md §5 describes a lender-funded loan; the real one pays the Admin
// ₱4,200 a week as earnings on their own capital. Both are correct; they are
// different loans. Worth knowing before anyone tests against the spec's figures.
