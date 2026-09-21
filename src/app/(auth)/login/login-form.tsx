'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'

import { Landmark } from 'lucide-react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { login, type LoginState } from '@/server/auth/actions.ts'

const initialState: LoginState = { error: null }

function SubmitButton() {
  // useFormStatus reads the enclosing form's state, so the button disables itself
  // while the action runs. Without it a double-click creates two sessions.
  const { pending } = useFormStatus()
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? 'Signing in…' : 'Sign in'}
    </Button>
  )
}

export function LoginForm() {
  const [state, formAction] = useActionState(login, initialState)

  return (
    <Card className="animate-in fade-in slide-in-from-bottom-2 w-full max-w-sm duration-300">
      <CardHeader>
        <div className="bg-primary/10 text-primary mb-1 flex size-10 items-center justify-center rounded-xl">
          <Landmark className="size-5" aria-hidden />
        </div>
        <CardTitle className="text-2xl tracking-tight">Lending App</CardTitle>
        <CardDescription>Sign in to manage lenders, borrowers and loans.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              required
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>

          {state.error ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          ) : null}

          <SubmitButton />
        </form>

        <div className="bg-muted/50 mt-6 rounded-lg border border-dashed p-3 text-center">
          <p className="text-muted-foreground text-xs font-medium">Try it with sample data</p>
          <p className="mt-1 font-mono text-sm">demo / demo1234</p>
        </div>
      </CardContent>
    </Card>
  )
}
