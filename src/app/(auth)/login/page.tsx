import { redirect } from 'next/navigation'

import { LoginForm } from '@/app/(auth)/login/login-form.tsx'
import { getCurrentUser } from '@/server/auth/guard.ts'

export const metadata = { title: 'Sign in · Consignment Kush' }

export default async function LoginPage() {
  // Someone already signed in has no business on the login screen.
  if (await getCurrentUser()) redirect('/')

  return (
    <main className="from-background to-brand-bg relative flex min-h-dvh items-center justify-center overflow-hidden bg-gradient-to-b px-4 py-10">
      {/* A soft brand glow behind the card, so it reads as lifted off the page
          rather than pasted onto a flat gradient. Decoration only. */}
      <div
        aria-hidden
        className="bg-brand/15 pointer-events-none absolute -top-40 h-[28rem] w-[28rem] rounded-full blur-3xl"
      />
      <LoginForm />
    </main>
  )
}
