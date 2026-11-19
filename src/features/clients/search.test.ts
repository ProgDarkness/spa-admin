import { describe, expect, it } from 'vitest'
import type { Client } from '@/lib/model'
import { matchesClientQuery, normalizeSearchText } from './search'

const CLIENT: Client = {
  id: 1,
  firstName: 'María José',
  lastName: 'Peña',
  nationalId: 'V-12345678',
  phone: '0414-1234567',
  deletedAt: null,
}

describe('normalizeSearchText', () => {
  it('quita diacríticos y pasa a minúsculas', () => {
    expect(normalizeSearchText('ÁÉÍÓÚ Ñandú Über')).toBe('aeiou nandu uber')
  })

  it('normaliza formas compuestas y descompuestas igual', () => {
    expect(normalizeSearchText('José')).toBe(normalizeSearchText('José'))
  })

  it('conserva dígitos, guiones y emojis', () => {
    expect(normalizeSearchText('V-123 ✨')).toBe('v-123 ✨')
  })

  it('devuelve vacío para vacío', () => {
    expect(normalizeSearchText('')).toBe('')
  })
})

describe('matchesClientQuery', () => {
  it.each(['maria', 'jose', 'pena', 'v-1234', '1234567', ''])('coincide con "%s"', (query) => {
    expect(matchesClientQuery(CLIENT, query)).toBe(true)
  })

  it.each(['zzz', 'v-9', 'maria pena'])('no coincide con "%s"', (query) => {
    expect(matchesClientQuery(CLIENT, query)).toBe(false)
  })
})
