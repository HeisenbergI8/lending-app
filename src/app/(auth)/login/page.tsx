import { redirect } from 'next/navigation'

import { LoginForm } from '@/app/(auth)/login/login-form.tsx'
import { PondexMark } from '@/components/shell/pondex-mark.tsx'
import { getCurrentUser } from '@/server/auth/guard.ts'

export const metadata = { title: 'Sign in' }

/**
 * The sign in screen.
 *
 * THE PAGE IS THE BRAND SURFACE, not the card. It used to be a white card a few
 * hundred pixels wide floating in a pale grey field — on a laptop that is a
 * small box in the middle of two thousand pixels of nothing, and no amount of
 * work on the card fixes the emptiness around it. The whole page is the navy
 * now, and the card is the one light object on it.
 *
 * THE GROUND IS A VERTICAL FALL, lifted at the top and deeper at the foot, with
 * one very broad bloom of the brand behind it. A tight radial was tried first
 * and read as a bright patch — a smudge rather than depth. The stops are the
 * navy ramp in hex rather than tokens because this gradient exists on exactly
 * one screen; a token used once is a second place to look for no gain.
 *
 * THE MARK IN THE BACKGROUND IS ONE OVERSIZED COPY, cropped by the corner at
 * about 5%. A repeated mark is the obvious move and the wrong one: tiled logos
 * read as wrapping paper. At this size it is texture first and a logo second,
 * which is the whole trick. It is sized in `vmin` so it crops the same way on a
 * phone and on a monitor without two sets of numbers.
 *
 * THE PADDING CARRIES THE DEVICE'S SAFE AREAS. Installed to a home screen this
 * screen has no browser chrome above it, so without the insets the lockup sits
 * under the notch and the demo line under the home indicator.
 *
 * THE LOCKUP SITS IN THE CORNER, mark in plain white with no tile behind it. In
 * a white rounded square it was a second white object a hand's width from the
 * card, and the two argued; anchored to the corner it stops floating, and the
 * card is left as the only centred thing on the page.
 */
export default async function LoginPage() {
  // Someone already signed in has no business on the login screen.
  if (await getCurrentUser()) redirect('/')

  return (
    <main
      className="relative flex min-h-dvh flex-col overflow-hidden px-5 pt-[calc(3.5rem+env(safe-area-inset-top,0px))] pb-[calc(2rem+env(safe-area-inset-bottom,0px))] text-white md:px-12 md:pt-[calc(2.5rem+env(safe-area-inset-top,0px))]"
      style={{
        backgroundColor: '#0e1a2d',
        backgroundImage:
          'radial-gradient(1600px 900px at 50% -20%, rgba(20, 65, 140, 0.38), rgba(14, 26, 45, 0) 68%), linear-gradient(180deg, #16263f 0%, #0e1a2d 45%, #0a1322 100%)',
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-[-18%] left-[-12%] w-[115vmin] -rotate-8 opacity-[0.055]"
      >
        <PondexMark className="h-auto w-full" />
      </div>

      <div className="relative flex items-center gap-2.5">
        <PondexMark className="size-5 text-white" />
        <span className="text-[1.05rem] font-semibold tracking-tight">Pondex</span>
      </div>

      {/* Centred on a laptop, but TOP ALIGNED ON A PHONE. A vertically centred
          form is thrown around when the keyboard opens — iOS Safari does not
          shrink dvh for it — so on a phone the card starts under the lockup and
          stays where it was put. */}
      <div className="relative flex flex-1 flex-col items-center justify-start pt-9 md:justify-center md:pt-0 md:pb-10">
        <LoginForm />

        <p className="mt-auto pt-8 text-center text-xs text-[#9fb0c9] md:mt-5 md:pt-0">
          Trying it out? Sign in with{' '}
          <span className="font-mono text-[#eef1f6]">demo</span> /{' '}
          <span className="font-mono text-[#eef1f6]">demo1234</span>
        </p>
      </div>
    </main>
  )
}
