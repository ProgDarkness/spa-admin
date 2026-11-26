import { describe, expect, it } from 'vitest'
import { backupExportFormSchema, backupPassphraseSchema, backupRestoreFormSchema } from './schemas'

const PASSPHRASE = 'frase de prueba larga'

function messagesOf(result: { success: boolean; error?: { issues: readonly { message: string; path: PropertyKey[] }[] } }) {
  return result.error?.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) ?? []
}

describe('backupPassphraseSchema', () => {
  it('acepta 12 code points y rechaza 11 con el mensaje de longitud mínima', () => {
    expect(backupPassphraseSchema.safeParse('a'.repeat(12)).success).toBe(true)
    expect(messagesOf(backupPassphraseSchema.safeParse('a'.repeat(11)))).toEqual([
      { path: '', message: 'La frase debe tener al menos 12 caracteres' },
    ])
  })

  it('cuenta los code points tras componer a NFC', () => {
    expect(backupPassphraseSchema.safeParse(`${'a'.repeat(10)}é`).success).toBe(false)
    expect(backupPassphraseSchema.safeParse(`${'a'.repeat(11)}é`).success).toBe(true)
  })

  it('acepta 1024 bytes y rechaza 1025 con el mensaje de longitud máxima', () => {
    expect(backupPassphraseSchema.safeParse('a'.repeat(1024)).success).toBe(true)
    expect(messagesOf(backupPassphraseSchema.safeParse('a'.repeat(1025)))).toEqual([
      { path: '', message: 'La frase es demasiado larga' },
    ])
  })

  it('mide el máximo en bytes UTF-8', () => {
    expect(backupPassphraseSchema.safeParse('😀'.repeat(256)).success).toBe(true)
    expect(backupPassphraseSchema.safeParse('😀'.repeat(257)).success).toBe(false)
  })

  it('no recorta los espacios de la frase', () => {
    const parsed = backupPassphraseSchema.parse(`  ${PASSPHRASE}  `)

    expect(parsed).toBe(`  ${PASSPHRASE}  `)
  })

  it('rechaza valores que no son texto', () => {
    expect(backupPassphraseSchema.safeParse(undefined).success).toBe(false)
    expect(backupPassphraseSchema.safeParse(12).success).toBe(false)
  })
})

describe('backupExportFormSchema', () => {
  it('acepta la frase con su confirmación idéntica', () => {
    expect(backupExportFormSchema.parse({ passphrase: PASSPHRASE, confirmation: PASSPHRASE })).toEqual({
      passphrase: PASSPHRASE,
      confirmation: PASSPHRASE,
    })
  })

  it('una confirmación distinta falla en el campo confirmation', () => {
    const result = backupExportFormSchema.safeParse({ passphrase: PASSPHRASE, confirmation: `${PASSPHRASE}x` })

    expect(messagesOf(result)).toEqual([{ path: 'confirmation', message: 'Las frases no coinciden' }])
  })

  it('la confirmación distingue mayúsculas y espacios finales', () => {
    expect(backupExportFormSchema.safeParse({ passphrase: PASSPHRASE, confirmation: PASSPHRASE.toUpperCase() }).success).toBe(false)
    expect(backupExportFormSchema.safeParse({ passphrase: PASSPHRASE, confirmation: `${PASSPHRASE} ` }).success).toBe(false)
  })

  it('formas NFC y NFD de la misma frase coinciden', () => {
    const composed = `${'a'.repeat(11)}é`
    const decomposed = `${'a'.repeat(11)}é`

    expect(backupExportFormSchema.safeParse({ passphrase: composed, confirmation: decomposed }).success).toBe(true)
  })

  it('una frase corta falla en passphrase', () => {
    const result = backupExportFormSchema.safeParse({ passphrase: 'corta', confirmation: 'corta' })

    expect(messagesOf(result)).toEqual([{ path: 'passphrase', message: 'La frase debe tener al menos 12 caracteres' }])
  })

  it('una frase corta con confirmación distinta informa ambos campos', () => {
    const result = backupExportFormSchema.safeParse({ passphrase: 'corta', confirmation: 'otra' })

    expect(messagesOf(result).map((issue) => issue.path).sort()).toEqual(['confirmation', 'passphrase'])
  })

  it('una confirmación vacía falla', () => {
    expect(backupExportFormSchema.safeParse({ passphrase: PASSPHRASE, confirmation: '' }).success).toBe(false)
  })
})

describe('backupRestoreFormSchema', () => {
  it('solo pide la frase y aplica sus límites', () => {
    expect(backupRestoreFormSchema.safeParse({ passphrase: PASSPHRASE }).success).toBe(true)
    expect(backupRestoreFormSchema.safeParse({ passphrase: 'corta' }).success).toBe(false)
    expect(backupRestoreFormSchema.safeParse({ passphrase: 'a'.repeat(1025) }).success).toBe(false)
  })
})
