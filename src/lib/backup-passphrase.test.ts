import { describe, expect, it } from 'vitest'
import {
  backupPassphraseProblem,
  MAX_BACKUP_PASSPHRASE_BYTES,
  MIN_BACKUP_PASSPHRASE_CODE_POINTS,
} from './backup-passphrase'

describe('constantes', () => {
  it('coinciden con las reglas de Rust', () => {
    expect(MIN_BACKUP_PASSPHRASE_CODE_POINTS).toBe(12)
    expect(MAX_BACKUP_PASSPHRASE_BYTES).toBe(1024)
  })
})

function isAcceptableBackupPassphrase(raw: string): boolean {
  return backupPassphraseProblem(raw) === null
}

describe('backupPassphraseProblem', () => {
  it('rechaza 11 code points y acepta 12', () => {
    expect(isAcceptableBackupPassphrase('a'.repeat(11))).toBe(false)
    expect(isAcceptableBackupPassphrase('a'.repeat(12))).toBe(true)
  })

  it('cuenta code points tras componer a NFC', () => {
    expect(isAcceptableBackupPassphrase(`${'a'.repeat(10)}é`)).toBe(false)
    expect(isAcceptableBackupPassphrase(`${'a'.repeat(11)}é`)).toBe(true)
  })

  it('acepta 1024 bytes y rechaza 1025', () => {
    expect(isAcceptableBackupPassphrase('a'.repeat(1024))).toBe(true)
    expect(isAcceptableBackupPassphrase('a'.repeat(1025))).toBe(false)
  })

  it('mide bytes UTF-8 y no unidades UTF-16', () => {
    expect(isAcceptableBackupPassphrase('😀'.repeat(256))).toBe(true)
    expect(isAcceptableBackupPassphrase('😀'.repeat(257))).toBe(false)
  })

  it('mide los bytes después de componer', () => {
    expect(isAcceptableBackupPassphrase('é'.repeat(512))).toBe(true)
  })

  it('no recorta espacios: una frase de espacios cuenta completa', () => {
    expect(isAcceptableBackupPassphrase(' '.repeat(12))).toBe(true)
  })

  it('una cadena vacía se rechaza', () => {
    expect(isAcceptableBackupPassphrase('')).toBe(false)
  })
})
