import { LoadingScreen } from '@/components/brand-loader.tsx'

/**
 * The fallback for the dashboard, and the backstop for any signed-in screen
 * that has not got one of its own.
 *
 * Every module folder carries its own `loading.tsx` beside this one. They are
 * three lines each and differ only in the sentence, which is the point: Next
 * prefetches a route's loading state, so the words are on screen the instant a
 * tab is tapped, and "Loading lenders…" while the lenders arrive is worth more
 * than a generic spinner on every screen in the app.
 *
 * The skeleton that used to live inline here now lives in `LoadingScreen`, so
 * every screen gets the same blocks under the same turning mark rather than the
 * dashboard alone getting a shape.
 */
export default function Loading() {
  return <LoadingScreen label="Loading the dashboard…" />
}
