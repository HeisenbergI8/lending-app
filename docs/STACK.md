# Lending App — Technologies

**Status:** stack agreed 2026-09-21. No code written yet.
**Context:** this is a CV project for a full-stack role, and it will also hold the owner's real
lending records. Both facts drove the choices below.

Features are in [FEATURES.md](FEATURES.md). This file is only about *how* it gets built.

---

## The stack

| Layer | Choice | Why |
| --- | --- | --- |
| Framework | **Next.js (App Router) + TypeScript** | One app, one deployment. Server and client in the same codebase, so it still reads as full-stack. Already known. |
| Database | **PostgreSQL** | More job postings ask for Postgres than MySQL, and free Postgres hosting is far better than free MySQL. |
| DB + file host | **Supabase** | Postgres *and* file storage in one service. One account, one dashboard, fewer things to break. |
| ORM | **Prisma** | Schema in one readable file, type-safe queries, and Prisma Studio for browsing data without SQL. Most-requested ORM in job postings. |
| Styling | **Tailwind CSS + shadcn/ui** | Components you copy in and own. Responsive by default, which matters because the app is used on both phone and laptop. |
| Auth | **Username + password** | Self-contained. Two accounts: the owner's real one, and a demo one for recruiters. Works even if the recruiter has no Google account. |
| PDF reports | **Server-side PDF renderer** | Reports are designed in React and rendered to a real PDF on the server. Runs within free-tier limits. |
| Tests | **Unit tests on the money math** | Interest, lender splits, whole-week validation. |
| Install | **PWA** | Installable to the phone home screen, opens full-screen. |
| Hosting | **Vercel (free)** | Zero config for Next.js. |

**Budget: ₱0/month.** Everything above has a free tier that covers this app's size.

---

## Non-negotiable: money is stored as integers

**Every peso amount is stored as a whole number of centavos.** ₱30,000.00 is stored as `3000000`.
Never as a decimal or a float.

Why this is not optional: the app multiplies capital by a percentage and splits the result between
lenders. Floating-point arithmetic loses fractions on exactly that kind of operation — ₱8,400 can
come out as ₱8,399.9999. Across many loans those lost centavos stop reconciling, and a lender is
quietly shortchanged.

Rules that follow from it:

- The database column is an integer type, not `FLOAT` or `DOUBLE`.
- Conversion to pesos happens **only at the moment of display**.
- Rounding is decided once, in one shared function, and every split goes through it.
- **The remainder from a split is never dropped.** When ₱8,400 splits three ways and doesn't divide
  evenly, the leftover centavo is assigned deliberately, not lost.

This is worth being able to explain in an interview. Most candidates get it wrong.

---

## Real data vs the demo

The owner uses this for real lending, and recruiters get a clickable link. Those two things conflict:
a recruiter must never see a real borrower's name and how much they owe.

- **Two accounts, one app.** The owner's real account, and a separate demo account seeded with
  made-up borrowers and lenders.
- Accounts are fully isolated — the demo account can never read the real account's data, and this is
  enforced on the server, not by hiding buttons in the UI.
- The demo account's data resets on a schedule, so a recruiter poking at it can't leave it broken.
- Real borrower names are personal financial information about people who never agreed to be in a CV
  project. Keeping them off the public link is the whole point.

---

## Free-tier traps to plan around

Known before a line of code is written, so they don't become surprises:

1. **Supabase pauses free projects after about a week of inactivity.** A recruiter clicking the CV
   link on a quiet week could hit a dead app. Needs a scheduled ping to keep it awake, or a paid
   upgrade before actively job-hunting. **This is the biggest risk to the project's purpose.**
2. **Free file storage is small.** Payment screenshots add up. Images should be compressed on upload
   rather than stored at full phone-camera resolution.
3. **Serverless functions have size and time limits.** This is why PDFs use a lightweight renderer
   rather than a headless browser, which will not fit.

---

## Not decided yet

- **Folder structure and file layout** — waiting until the project is actually scaffolded.
- **`harness.config.json` verify commands** are still `null`, deliberately. Pointing them at scripts
  that do not exist yet would make the gates fail for reasons unrelated to the code. Fill them in
  the same change that creates `package.json`.
