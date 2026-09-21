import { redirect } from 'next/navigation'

import { LoginForm } from '@/app/(auth)/login/login-form.tsx'
import { getCurrentUser } from '@/server/auth/guard.ts'

export const metadata = { title: 'Sign in · Lending App' }

export default async function LoginPage() {
  // Someone already signed in has no business on the login screen.
  if (await getCurrentUser()) redirect('/')

  return (
    <main className="flex min-h-dvh items-center justify-center bg-muted/30 px-4 py-10">
      <LoginForm />
    </main>
  )
}
