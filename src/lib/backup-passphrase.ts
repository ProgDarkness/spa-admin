import { countCodePoints } from './text'

export const MIN_BACKUP_PASSPHRASE_CODE_POINTS = 12
export const MAX_BACKUP_PASSPHRASE_BYTES = 1024

export type BackupPassphraseProblem = 'tooShort' | 'tooLong'

const utf8Encoder = new TextEncoder()

export function backupPassphraseProblem(raw: string): BackupPassphraseProblem | null {
  const composed = raw.normalize('NFC')
  if (countCodePoints(composed) < MIN_BACKUP_PASSPHRASE_CODE_POINTS) return 'tooShort'
  return utf8Encoder.encode(composed).length > MAX_BACKUP_PASSPHRASE_BYTES ? 'tooLong' : null
}
