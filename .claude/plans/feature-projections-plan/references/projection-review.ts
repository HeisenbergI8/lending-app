// src/lib/money/projection.ts — projects ONE lender pot's floating funds to a chosen day, if every
// borrower pays on time. Excerpt: the per-row scheduling loop the plan extracts (Phase 1.3).

// IMPORTANT: this loop is the only existing statement of "when does a running loan's money come back".
// The Projections engine must reuse it (as scheduleArrivals), never re-derive it.
for (const row of rows) {
  if (row.interestCollection === 'WEEKLY') {
    const weeks = row.termDays / DAYS_PER_WEEK
    const earnings = weeklySlices(row.earnings, weeks)
    const cuts = weeklySlices(row.adminCut, weeks)
    weeklyDueDates(row.startOn, weeks).forEach((day, index) => {
      const week = index + 1
      if (row.paidWeeks.has(week)) return
      const last = week === weeks
      add(row, day, last ? row.principal : 0, earnings[index], cuts[index], last)
    })
  } else {
    add(row, row.dueOn, row.principal, row.earnings, row.adminCut, true)
  }
}

// NOTE: inside `add`, an arrival dated before `today` goes to `late` and is NOT projected.
// The engine keeps that rule (Simulation.lateNow), so both features agree on overdue money.
//   if (daysBetween(today, day) < 0) { late += capital + interest + adminCut; return }

// NOTE: ProjectedRow.adminCut is "the Admin cut this pot receives" — non-zero only when projecting the
// Admin pot. The engine instead routes every row's adminCut to the isSelf lender (RealRow).
