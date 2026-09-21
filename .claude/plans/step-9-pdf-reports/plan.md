# Step 9 — PDF reports

Build order step 9 (docs/ARCHITECTURE.md), specified by docs/FEATURES.md §9.

**Four reports:** overall summary · per lender · per borrower · per borrower, full file.
Any date range the admin picks. Output is a PDF saved to the device; the app sends nothing.

## Decisions taken before writing code

- **`@react-pdf/renderer` 4.9.0** — React components rendered to a real PDF on the server, which is
  what docs/STACK.md decided. Not a headless browser: STACK's free-tier trap #3 says one will not
  fit in a serverless function. Proven in this repo before building on it — a spike rendered a real
  PDF with an embedded font.
- **The app's own typeface is bundled** (`src/server/reports/fonts/`, Geist Regular + SemiBold,
  126 KB each, SIL OFL, licence kept beside them). The built-in PDF fonts have NO ₱ glyph: a peso
  sign silently renders as `±`. Confirmed by rendering the spike to an image and looking at it.
  Decided with the owner over writing "PHP 121,000.00" instead.
- **Proof screenshots are LISTED, not embedded** — name, size and upload date. Decided with the
  owner. Embedding phone photos would produce multi-megabyte PDFs and risk the function timing out.
- **One route, `/api/reports?kind=…`**, rather than the `/api/reports/[kind]/` path sketched in
  ARCHITECTURE. A plain GET form cannot change its own action without JavaScript, and the whole app
  works without it; a query parameter keeps the forms plain.

## What a date range means

An event is in the range when its own date is: a loan by `startOn`, a payment by `paidOn`, a
lender's money in or out by `occurredOn`. Position figures — floating, still out, what a borrower
owes — are always AS OF TODAY and labelled that way on the page, because "floating as of last
March" is not a question the ledger can answer from what it stores.

## Phases

1. **Report data.** `src/server/reports/queries.ts` — summary, lender, borrower (the full file is
   the borrower report with its payments and proofs included). Every query scoped to `userId`.
2. **The documents.** `src/server/reports/document.tsx` — font registration and the four report
   layouts, sharing one page shell and one table.
3. **The route.** `src/app/api/reports/route.ts` — validates the kind, the range and the id, renders
   and returns a PDF as an attachment.
4. **The page.** `src/app/(app)/reports/page.tsx` — three plain GET forms, no JavaScript needed.
5. **Tests and docs.** Range parsing and the report arithmetic; then ARCHITECTURE, README,
   CONVENTIONS and next.config tracing for the font files.
