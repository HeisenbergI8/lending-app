// Review of src/server/payments/queries.ts (59 lines) — reading a payment and its
// proof. Small, and it needs one change plus one decision.

/**
 * "The links are signed HERE, per render, and last minutes. The bucket is
 *  private, so there is no URL to store — which is the point: a screenshot of
 *  somebody's GCash transfer should not sit behind an address that keeps working
 *  after it is pasted somewhere it should not be."
 */

export async function paymentForLoan(userId: string, loanId: string): Promise<PaymentView | null> {
  const payment = await db.payment.findFirst({
    where: { loanId, userId, deletedAt: null },        // <-- IMPORTANT: unscoped by week
    select: {
      paidOn: true,
      amountCentavos: true,
      proofFiles: { where: { deletedAt: null }, orderBy: { uploadedAt: 'asc' }, select: { ... } },
    },
  })
  // IMPORTANT: `findFirst` with no ordering. On a weekly loan this returns
  // WHICHEVER payment Postgres hands back first — quite possibly week 3 — and the
  // loan page's Payment section would show a ₱4,200 week where the ₱64,200
  // settlement belongs. Must gain `weekNumber: null`.
  //
  // It type-checks either way, and on the four existing payments in the database
  // it behaves identically. A test written against an AT_END loan cannot catch it.
}

// ---- The per-file round trips --------------------------------------------
const files = await Promise.all(
  payment.proofFiles.map(async (file) => ({
    ...,
    url: configured ? await signProof(file.storagePath).catch(() => null) : null,
  })),
)
// "One round trip per file, in parallel. A payment carries a handful of files,
//  not a gallery, so this is two or three requests rather than a queue."
//
// QUESTION: the loan page for a weekly loan may want the proof for TWENTY
// payments. At two files each that is forty signing round trips on one render,
// and the reasoning quoted above no longer holds — a weekly loan IS the gallery
// case this comment says does not exist.
//
// The plan's schedule shows `missingProof` per week (a boolean from a count) and
// does NOT sign forty links. Opening one week's proof should be a separate fetch,
// or the page will be slow in a way that is nobody's obvious fault. Worth deciding
// before Step 6.1 is built rather than after.

// NOTE: `storageConfigured()` is checked once and the url is null when storage is
// absent, so the schedule degrades to "no proof link" rather than erroring. The
// same behaviour a weekly schedule wants.
