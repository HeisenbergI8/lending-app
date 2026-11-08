// src/server/lenders/queries.ts — lender reads. Two functions the plan builds on.

// listLenders: every non-deleted lender, Admin pot first, with lenderPosition() — the Floating figure
// the lenders list shows. Phase 5 starts every projection from exactly this number.
export async function listLenders(userId: string): Promise<LenderSummary[]> { /* ledgers(userId) ... */ }
// NOTE: ledgers() reads every funding row and transaction in the account (its own comment calls it heavy).
// The dashboard already calls listLenders, so Phase 7 passes that result into projectionContext.

// projectedFloating: the real-rows query Phase 5 copies, minus the per-lender filter.
const funding = await db.loanFunding.findMany({
  where: {
    userId,
    loan: { deletedAt: null, status: 'ACTIVE' },
    OR: [{ lenderId: lender.id }, ...(lender.isSelf ? [{ adminCutCentavos: { gt: 0 } }] : [])],
  },
  select: {
    lenderId: true, principalCentavos: true, earningsCentavos: true, adminCutCentavos: true,
    loan: { select: {
      id: true, interestCollection: true, startOn: true, dueOn: true, termDays: true,
      // IMPORTANT: live weekly payments only — an undone payment is archived and must not read as paid.
      payments: { where: { deletedAt: null, weekNumber: { not: null } }, select: { weekNumber: true } },
    } },
  },
})
// IMPORTANT: dates go through storedCalendarDate() on read (CONVENTIONS.md read-side date trap).
