import type { MetadataRoute } from 'next'

/**
 * What the phone reads when the admin taps "Add to Home Screen".
 *
 * `display: standalone` is the whole point: opened from the home screen the app
 * gets the full screen with no browser chrome, so it reads as an app rather
 * than a bookmark. The URL bar was also the one place a stray tap could leave
 * the app mid-form.
 *
 * `background_color` is the splash screen behind the icon while the first page
 * loads, and it matches --background in globals.css. A mismatch shows as a
 * flash of the wrong colour on every cold start.
 *
 * The icons are renders of src/app/icon.svg. Android crops any icon it is given
 * to the launcher's own shape, so the maskable one is a separate full-bleed
 * square with the mark inside the safe area — handing it the rounded square
 * would round it twice and shave the corners off.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Pondex',
    short_name: 'Pondex',
    description: 'Track loans, lenders and repayments.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#f6f7f9',
    theme_color: '#f6f7f9',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
