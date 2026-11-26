'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import Link from 'next/link'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Form } from '@/components/ui/form'
import { ROUTES } from '@/lib/routes'
import { useSession } from '@/lib/session'
import { setupOwner } from '../api'
import { errorTextOf } from '../error-text'
import { ownerSetupSchema, type OwnerSetupInput } from '../schemas'
import { AuthTextField } from './auth-text-field'
import { RecoveryCodePanel } from './recovery-code-panel'

const EMPTY_OWNER: OwnerSetupInput = { username: '', password: '', confirmPassword: '' }

type SetupOwnerFormProps = { onComplete: () => void }

export function SetupOwnerForm({ onComplete }: SetupOwnerFormProps) {
  const { refresh } = useSession()
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null)
  const [errorText, setErrorText] = useState<string | null>(null)
  const form = useForm<OwnerSetupInput>({ resolver: zodResolver(ownerSetupSchema), defaultValues: EMPTY_OWNER })

  async function submit({ username, password }: OwnerSetupInput) {
    setErrorText(null)
    const result = await setupOwner({ username, password })
    if (result.status === 'error') {
      setErrorText(errorTextOf(result.error))
      return
    }
    form.reset(EMPTY_OWNER)
    await refresh()
    setRecoveryCode(result.data.recoveryCode)
  }

  function finish() {
    setRecoveryCode(null)
    onComplete()
  }

  if (recoveryCode !== null) {
    return <RecoveryCodePanel heading="Tu código de recuperación" code={recoveryCode} onContinue={finish} />
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submit)} className="grid w-full max-w-sm gap-4" noValidate>
        <AuthTextField control={form.control} name="username" label="Usuario" autoComplete="username" />
        <AuthTextField control={form.control} name="password" label="Contraseña" type="password" autoComplete="new-password" />
        <AuthTextField control={form.control} name="confirmPassword" label="Confirmar contraseña" type="password" autoComplete="new-password" />
        {errorText ? (
          <p role="alert" className="text-sm text-destructive">
            {errorText}
          </p>
        ) : null}
        <Button type="submit" disabled={form.formState.isSubmitting}>
          Crear cuenta
        </Button>
        <Link href={ROUTES.restoreFirstRun} className="text-center text-sm text-primary underline-offset-4 hover:underline">
          Restaurar desde un respaldo
        </Link>
      </form>
    </Form>
  )
}
