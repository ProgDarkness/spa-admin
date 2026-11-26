'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useState, type ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import type { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Form } from '@/components/ui/form'
import { AuthTextField } from '@/features/auth/components/auth-text-field'
import { appErrorOf, UNEXPECTED_ERROR } from '@/lib/result'
import { useSession } from '@/lib/session'
import { useRestoreBackup } from '../hooks'
import { backupRestoreFormSchema } from '../schemas'
import { BackupPanelFeedback } from './backup-panel-feedback'

type RestoreFormValues = z.input<typeof backupRestoreFormSchema>

const EMPTY_RESTORE_FORM: RestoreFormValues = { passphrase: '' }
const RESTORING_MESSAGE = 'Restaurando respaldo…'

type RestoreBackupPanelProps = { onRestored: () => void; advice?: ReactNode }

export function RestoreBackupPanel({ onRestored, advice }: RestoreBackupPanelProps) {
  const { refresh } = useSession()
  const restoreBackup = useRestoreBackup()
  const [hasUnderstood, setHasUnderstood] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)
  const form = useForm<RestoreFormValues>({ resolver: zodResolver(backupRestoreFormSchema), defaultValues: EMPTY_RESTORE_FORM })
  const isRestoring = form.formState.isSubmitting

  async function submit({ passphrase }: RestoreFormValues) {
    setErrorText(null)
    try {
      const restored = await restoreBackup.mutateAsync(passphrase)
      if (restored === null) return
      form.reset(EMPTY_RESTORE_FORM)
      await refresh()
      onRestored()
    } catch (caught) {
      setErrorText((appErrorOf(caught) ?? UNEXPECTED_ERROR).message)
    }
  }

  return (
    <section aria-labelledby="restore-backup-heading" className="grid gap-4">
      <h2 id="restore-backup-heading" className="font-serif text-xl font-medium">
        Restaurar respaldo
      </h2>
      <div data-tone="warning" className="grid gap-2 rounded-md border-2 border-destructive p-4 text-sm">
        <p className="font-semibold">Atención: acción irreversible</p>
        <p>La restauración reemplaza todos los datos y la clave actuales por los del respaldo y no se puede deshacer.</p>
        {advice}
      </div>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(submit)} className="grid w-full max-w-sm gap-4" noValidate>
          <AuthTextField
            control={form.control}
            name="passphrase"
            label="Frase del respaldo a restaurar"
            type="password"
            autoComplete="off"
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={hasUnderstood}
              onChange={(event) => setHasUnderstood(event.target.checked)}
            />
            Entiendo que se reemplazarán todos los datos actuales
          </label>
          <BackupPanelFeedback message={isRestoring ? RESTORING_MESSAGE : null} errorText={errorText} />
          <Button type="submit" variant="destructive" disabled={!hasUnderstood || isRestoring}>
            {isRestoring ? 'Restaurando…' : 'Restaurar respaldo'}
          </Button>
        </form>
      </Form>
    </section>
  )
}
