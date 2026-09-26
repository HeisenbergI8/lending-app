import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'

import './globals.css'

import { MoneyBurst } from '@/components/money-burst.tsx'
import { SoundOnNavigate } from '@/components/sound-on-navigate.tsx'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
  // If the font fails to load — offline, blocked, a slow first paint — the page
  // must still be sans. Without this it falls back to the browser default, which
  // is a serif, and a financial UI in Times reads as broken.
  fallback: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
  fallback: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
})

export const metadata: Metadata = {
  title: { default: 'Pondex', template: '%s · Pondex' },
  description: 'Track loans, lenders and repayments.',
}

export const viewport: Viewport = {
  // viewport-fit=cover is what lets env(safe-area-inset-*) return real values,
  // which the phone tab bar and the sticky header both depend on.
  viewportFit: 'cover',
  // These are --background from globals.css, not round numbers near it. Once
  // the app is installed this colour IS the status bar, sitting directly above
  // the page — a shade off shows as a seam across the top of the screen.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f7f9' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0e15' },
  ],
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        {children}
        <SoundOnNavigate />
        <MoneyBurst />
      </body>
    </html>
  )
}
