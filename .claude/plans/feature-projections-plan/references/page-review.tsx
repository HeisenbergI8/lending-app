// src/app/(app)/page.tsx — the dashboard. Only lines 1-80 were read.

// IMPORTANT: the dashboard already loads lenders; Phase 7 reuses this result instead of calling
// listLenders again from projectionContext.
const [lenders, borrowers, people, overdue, interest, photos, due] = await Promise.all([
  listLenders(user.id),
  topBorrowers(user.id, SHOWN),
  borrowerCounts(user.id),
  overdueSummary(user.id),
  interestSummary(user.id),
  borrowerPhotoUrls(user.id),
  dueThisWeek(user.id),
])

// NOTE: "Exactly ONE hero" — the preview card must not be a second hero StatTile.
// NOTE: every dashboard number is derived from the same queries other screens use; the preview keeps
// that rule by calling the same projectionContext/forecast the Projections page uses.
// QUESTION: where in the layout below line 80 the card fits best was not read; the plan leaves placement
// to the implementer.
