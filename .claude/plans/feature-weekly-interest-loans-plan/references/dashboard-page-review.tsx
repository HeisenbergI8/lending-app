// Review of src/app/(app)/page.tsx (318 lines) — the four figures FEATURES.md §10
// asks for, and which query feeds each.

/**
 * "Every number here is DERIVED from the same queries the lender and borrower
 *  screens use, never from a separate dashboard aggregate. A second way of
 *  summing the same money is a second answer waiting to disagree with the first,
 *  and the admin would have no way to tell which of the two was lying."
 *
 * IMPORTANT: that is the property Phase 5 must preserve. Every tile below moves
 * because its query moved, not because the page learned about weekly loans. The
 * page itself changes only a label.
 */

const [lenders, borrowers, people, overdue, interest] = await Promise.all([
  listLenders(user.id),        // -> ledgers()       -> Floating, Out on loan, Earned
  topBorrowers(user.id, 6),    // -> toSummary()     -> what each borrower owes
  borrowerCounts(user.id),
  overdueSummary(user.id),     // -> loanWhere()     -> overdue count / sum / people
  interestSummary(user.id),    // -> Loan.interestCentavos by status
])

const pots = lenders.reduce((sum, l) => ({
  floating: sum.floating + l.position.floating,
  out: sum.out + l.position.outOnLoan,
}), { floating: 0, out: 0 })
// NOTE: summed across lenders in JS from lenderPosition, so Phase 5's change to
// ledgers() reaches both hero figures with no edit here.

// "The admin is a lender row with isSelf — their earnings are their own cut on
//  other people's money plus what their own capital made, already added up by
//  lenderPosition. There is no separate admin ledger to reconcile."
const self = lenders.find((lender) => lender.isSelf)

// ---- The tile that must be relabelled ------------------------------------
// The Admin earnings / interest tile reads interestSummary().collected, which
// after Step 5.3 includes weeks collected on loans that have NOT been repaid.
//
// IMPORTANT — label-truth is mandatory here, by its own trigger: "before writing
// or editing anything that displays a figure from the database — a stat tile, a
// table column, a total, a badge". The figure's meaning changes underneath a
// label that was accurate before and is ambiguous after. "Earned" was true when
// interest arrived only on repayment.
//
// NOTE: there is precedent on this exact screen. Commit 1e9a48f, "Stop the Earned
// tile claiming its money is sitting in Floating" — the same tile, the same class
// of mistake, already made and already fixed once. Worth reading that commit
// before choosing the new wording.

// ---- The hero, and the rule about how many there are ---------------------
<StatTile hero icon={HandCoins} label="Out on loan" value={<Money variant="display" />} />
// "Exactly ONE hero. More than one and the eye has nowhere to land, which is the
//  whole job of a headline number."
// NOTE: nothing in this feature adds a tile. "Out on loan" holding steady while a
// weekly loan drips interest in is the behaviour FEATURES.md §5 describes, and it
// is what this hero will now correctly show.

// ---- variant="display" vs "column" ---------------------------------------
// Every figure on this page is variant="display" — no tabular-nums. CONVENTIONS.md:
// "On a stat tile it gives every digit the width of a zero and ₱121 reads loose
//  and gappy." The weekly schedule table is the opposite case and uses "column".

// NOTE: the page renders no loan rows at all — "it shows a count, a sum and how
// many PEOPLE are late", all aggregates. So the loanState call-site table in Phase
// 4 does not include this file, and that is correct rather than an omission.
