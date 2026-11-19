'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { BrandLogo } from '@/components/brand-logo'
import { Button } from '@/components/ui/button'
import { Form } from '@/components/ui/form'
import { useSession } from '@/lib/session'
import { errorTextOf, unlockErrorTextOf } from '../error-text'
import { unlockSchema, type UnlockInput } from '../schemas'
import { AuthTextField } from './auth-text-field'

const EMPTY_UNLOCK: UnlockInput = { password: '' }
const LOCK_EXPLANATION_ID = 'lock-explanation'
const LOCK_ANNOUNCEMENT = 'Sesión bloqueada por inactividad'

export function LockScreen() {
  const { unlock, signOut } = useSession()
  const [errorText, setErrorText] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const form = useForm<UnlockInput>({ resolver: zodResolver(unlockSchema), defaultValues: EMPTY_UNLOCK })

  useEffect(() => {
    form.setFocus('password')
    const timer = setTimeout(() => setAnnouncement(LOCK_ANNOUNCEMENT), 0)
    return () => clearTimeout(timer)
  }, [form])

  async function submit({ password }: UnlockInput) {
    setErrorText(null)
    const result = await unlock(password)
    if (result.status === 'ok') return
    setErrorText(unlockErrorTextOf(result.error))
    form.reset(EMPTY_UNLOCK)
    form.setFocus('password')
  }

  async function switchUser() {
    setErrorText(null)
    const result = await signOut()
    if (result.status === 'error') setErrorText(errorTextOf(result.error))
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <section
        aria-labelledby="lock-heading"
        className="flex w-full max-w-sm flex-col items-center gap-6 rounded-lg border border-border bg-card p-8 text-card-foreground"
      >
        <BrandLogo size={56} />
        <h1 id="lock-heading" className="font-serif text-2xl font-semibold">
          Sesión bloqueada
        </h1>
        <p role="status" className="sr-only">
          {announcement}
        </p>
        <p id={LOCK_EXPLANATION_ID} className="text-center text-sm text-muted-foreground">
          Por inactividad, la sesión se bloqueó. Ingresa tu contraseña para continuar.
        </p>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(submit)} className="grid w-full gap-4" noValidate>
            <AuthTextField
              control={form.control}
              name="password"
              label="Contraseña"
              type="password"
              autoComplete="current-password"
              describedBy={LOCK_EXPLANATION_ID}
            />
            {errorText ? (
              <p role="alert" className="text-sm text-destructive">
                {errorText}
              </p>
            ) : null}
            <Button type="submit" disabled={form.formState.isSubmitting}>
              Desbloquear
            </Button>
            <Button type="button" variant="outline" onClick={() => void switchUser()}>
              Cambiar de usuario
            </Button>
          </form>
        </Form>
      </section>
    </main>
  )
}
