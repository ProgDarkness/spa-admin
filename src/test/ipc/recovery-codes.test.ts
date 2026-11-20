import { describe, expect, it } from 'vitest'
import { canonicalRecoveryCode, formatRecoveryCode, normalizeRecoveryCode } from './recovery-codes'

describe('recovery-codes', () => {
  it('genera 20 caracteres del alfabeto base32', () => {
    expect(canonicalRecoveryCode(0)).toMatch(/^[A-Z2-7]{20}$/)
  })

  it('formatea en cinco grupos de cuatro separados por guion', () => {
    expect(formatRecoveryCode(0)).toMatch(/^[A-Z2-7]{4}(-[A-Z2-7]{4}){4}$/)
  })

  it('cada rotación produce un código distinto y determinista', () => {
    expect(canonicalRecoveryCode(1)).not.toBe(canonicalRecoveryCode(0))
    expect(canonicalRecoveryCode(3)).toBe(canonicalRecoveryCode(3))
  })

  it('el formato y el canónico describen el mismo código', () => {
    expect(formatRecoveryCode(2).replaceAll('-', '')).toBe(canonicalRecoveryCode(2))
  })

  it('normaliza guiones, espacios y minúsculas', () => {
    expect(normalizeRecoveryCode(' abcd-efgh ij ')).toBe('ABCDEFGHIJ')
  })
})
