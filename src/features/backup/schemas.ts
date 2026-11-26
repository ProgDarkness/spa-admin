import { z } from 'zod'
import {
  backupPassphraseProblem,
  MIN_BACKUP_PASSPHRASE_CODE_POINTS,
  type BackupPassphraseProblem,
} from '@/lib/backup-passphrase'

const PROBLEM_MESSAGES: Readonly<Record<BackupPassphraseProblem, string>> = {
  tooShort: `La frase debe tener al menos ${MIN_BACKUP_PASSPHRASE_CODE_POINTS} caracteres`,
  tooLong: 'La frase es demasiado larga',
}
const MISMATCH_MESSAGE = 'Las frases no coinciden'

function addPassphraseIssue(passphrase: string, context: z.RefinementCtx, path: (string | number)[]): void {
  const problem = backupPassphraseProblem(passphrase)
  if (problem) context.addIssue({ code: 'custom', message: PROBLEM_MESSAGES[problem], path })
}

export const backupPassphraseSchema = z.string().superRefine((passphrase, context) => addPassphraseIssue(passphrase, context, []))

export const backupRestoreFormSchema = z.object({ passphrase: backupPassphraseSchema })

export const backupExportFormSchema = z
  .object({ passphrase: z.string(), confirmation: z.string() })
  .superRefine(({ passphrase, confirmation }, context) => {
    addPassphraseIssue(passphrase, context, ['passphrase'])
    if (passphrase.normalize('NFC') !== confirmation.normalize('NFC')) {
      context.addIssue({ code: 'custom', message: MISMATCH_MESSAGE, path: ['confirmation'] })
    }
  })
