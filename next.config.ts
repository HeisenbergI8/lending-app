import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  /**
   * The report PDFs read their font off disk at render time, and file tracing
   * cannot see a path built with path.join. Without this the fonts are left out
   * of the deployed function and every report falls back to a font with no ₱.
   */
  outputFileTracingIncludes: {
    '/api/reports': ['src/server/reports/fonts/**'],
  },
  /**
   * The Archive screen became Recently Deleted. Anything pointing at the old
   * path — a bookmark, a pinned tab on the admin's phone — lands on the new one
   * rather than a 404 that looks like the feature was dropped.
   */
  async redirects() {
    return [{ source: '/archive', destination: '/deleted', permanent: true }]
  },
  experimental: {
    serverActions: {
      /**
       * Proof-of-payment screenshots arrive through a server action, and the
       * default cap is 1MB — smaller than a single photo from a modern phone.
       *
       * This sits ABOVE the per-file limit in src/lib/proof.ts on purpose: a
       * file the app refuses gets a sentence explaining why, where one the
       * framework refuses gets a generic failure with nothing to act on. The
       * headroom also covers several files in one submission.
       */
      bodySizeLimit: '12mb',
    },
  },
}

export default nextConfig
