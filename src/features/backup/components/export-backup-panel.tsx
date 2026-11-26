'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import type { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Form } from '@/components/ui/form'
import { AuthTextField } from '@/features/auth/components/auth-text-field'
import { formatAuditTimestamp } from '@/features/auth/format-audit-timestamp'
import type { BackupExported } from '@/lib/bindings'
import { appErrorOf, UNEXPECTED_ERROR } from '@/lib/result'
import { useExportBackup } from '../hooks'
import { backupExportFormSchema } from '../schemas'
import { BackupPanelFeedback } from './backup-panel-feedback'

type ExportFormValues = z.input<typeof backupExportFormSchema>

const EMPTY_EXPORT_FORM: ExportFormValues = { passphrase: '', confirmation: '' }
const EXPORTING_MESSAGE = 'Exportando respaldo…'

type ExportOutcome = { kind: 'idle' } | { kind: 'done'; exported: BackupExported } | { kind: 'failed'; errorText: string }

const IDLE_OUTCOME: ExportOutcome = { kind: 'idle' }

function savedMessageOf({ fileName, createdAt }: BackupExported): string {
  return `Respaldo guardado: ${fileName} (${formatAuditTimestamp(createdAt)})`
}

function messageOf(outcome: ExportOutcome, isExporting: boolean): string | null {
  if (isExporting) return EXPORTING_MESSAGE
  return outcome.kind === 'done' ? savedMessageOf(outcome.exported) : null
}

export function ExportBackupPanel() {
  const exportBackup = useExportBackup()
  const [outcome, setOutcome] = useState<ExportOutcome>(IDLE_OUTCOME)
  const form = useForm<ExportFormValues>({ resolver: zodResolver(backupExportFormSchema), defaultValues: EMPTY_EXPORT_FORM })
  const isExporting = form.formState.isSubmitting

  async function submit({ passphrase }: ExportFormValues) {
    setOutcome(IDLE_OUTCOME)
    try {
      const exported = await exportBackup.mutateAsync(passphrase)
      if (exported === null) return
      form.reset(EMPTY_EXPORT_FORM)
      setOutcome({ kind: 'done', exported })
    } catch (caught) {
      form.reset(EMPTY_EXPORT_FORM)
      setOutcome({ kind: 'failed', errorText: (appErrorOf(caught) ?? UNEXPECTED_ERROR).message })
    }
  }

  return (
    <section id="exportar" aria-labelledby="export-backup-heading" className="grid gap-4">
      <h2 id="export-backup-heading" className="font-serif text-xl font-medium">
        Exportar respaldo
      </h2>
      <p className="text-sm text-muted-foreground">
        Guarda una copia cifrada de todos los datos en un archivo. Guárdala en una memoria USB u otro lugar seguro.
      </p>
      <p className="text-sm font-medium">Si pierdes la frase, el respaldo no se puede recuperar.</p>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(submit, () => setOutcome(IDLE_OUTCOME))} className="grid w-full max-w-sm gap-4" noValidate>
          <AuthTextField control={form.control} name="passphrase" label="Frase del respaldo" type="password" autoComplete="new-password" />
          <AuthTextField control={form.control} name="confirmation" label="Confirmar frase" type="password" autoComplete="new-password" />
          <BackupPanelFeedback
            message={messageOf(outcome, isExporting)}
            errorText={outcome.kind === 'failed' ? outcome.errorText : null}
          />
          <Button type="submit" disabled={isExporting}>
            {isExporting ? 'Exportando…' : 'Exportar respaldo'}
          </Button>
        </form>
      </Form>
    </section>
  )
}
