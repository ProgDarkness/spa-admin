'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Form } from '@/components/ui/form'
import { recoverPassword } from '../api'
import { errorTextOf } from '../error-text'
import { normalizeRecoveryCode, recoverySchema, type RecoveryInput } from '../schemas'
import { AuthTextField } from './auth-text-field'
import { RecoveryCodePanel } from './recovery-code-panel'

const EMPTY_RECOVERY: RecoveryInput = { username: '', recoveryCode: '', newPassword: '', confirmPassword: '' }

type RecoverFormProps = { onComplete: () => void }

export function RecoverForm({ onComplete }: RecoverFormProps) {
  const [newRecoveryCode, setNewRecoveryCode] = useState<string | null>(null)
  const [errorText, setErrorText] = useState<string | null>(null)
  const form = useForm<RecoveryInput>({ resolver: zodResolver(recoverySchema), defaultValues: EMPTY_RECOVERY })

  async function submit({ username, recoveryCode, newPassword }: RecoveryInput) {
    setErrorText(null)
    const result = await recoverPassword({ username, recoveryCode: normalizeRecoveryCode(recoveryCode), newPassword })
    if (result.status === 'error') {
      setErrorText(errorTextOf(result.error))
      return
    }
    form.reset(EMPTY_RECOVERY)
    setNewRecoveryCode(result.data.recoveryCode)
  }

  function finish() {
    setNewRecoveryCode(null)
    onComplete()
  }

  if (newRecoveryCode !== null) {
    return <RecoveryCodePanel heading="Tu nuevo código de recuperación" code={newRecoveryCode} onContinue={finish} />
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submit)} className="grid w-full max-w-sm gap-4" noValidate>
        <AuthTextField control={form.control} name="username" label="Usuario" autoComplete="username" />
        <AuthTextField
          control={form.control}
          name="recoveryCode"
          label="Código de recuperación"
          autoComplete="off"
          spellCheck={false}
          autoCapitalize="characters"
          autoCorrect="off"
        />
        <AuthTextField control={form.control} name="newPassword" label="Nueva contraseña" type="password" autoComplete="new-password" />
        <AuthTextField control={form.control} name="confirmPassword" label="Confirmar nueva contraseña" type="password" autoComplete="new-password" />
        {errorText ? (
          <p role="alert" className="text-sm text-destructive">
            {errorText}
          </p>
        ) : null}
        <Button type="submit" disabled={form.formState.isSubmitting}>
          Restablecer contraseña
        </Button>
      </form>
    </Form>
  )
}
