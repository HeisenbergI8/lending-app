// src/app/(app)/lenders/[id]/where-the-money-is.tsx — the only chart in the app: a donut of a pot's parts.

// NOTE: no chart library. Hand-drawn SVG paths in a server component; package.json has no chart dependency.
// The Projections chart follows the same approach (polyline in an <svg>), adding nothing to package.json.
<svg viewBox="0 0 160 160" role="img" aria-label="Where the money is, by part">
  {slices.map(({ part, d }) => (
    // NOTE: selection is a URL, not client state — each slice is a <Link href="?part=...">.
    // Projections copies this for ?month=, ?view=, ?compare=.
    <Link key={part.key} href={part.href} scroll={false} aria-label={part.label}>
      <path d={d} fill={part.color} />
    </Link>
  ))}
</svg>

// IMPORTANT: part.color comes from the caller. In lenders/[id]/page.tsx (lines ~490-524) the parts use
// 'var(--status-good)' and 'var(--status-critical)' alongside 'var(--series-1..3)'. CONVENTIONS.md
// reserves status colours for loan state. Projections uses only --series-1..3 (three tokens exist in
// globals.css, which is what caps a comparison at three plans).
