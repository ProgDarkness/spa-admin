import { describe, expect, it } from 'vitest'
import { normalizeNationalId } from './national-id'

describe('normalizeNationalId', () => {
  it.each([
    ['V-12345678', 'V-12345678'],
    ['v-12345678', 'V-12345678'],
    ['V12345678', 'V-12345678'],
    ['V 12345678', 'V-12345678'],
    ['  e-81234567  ', 'E-81234567'],
    ['V-12.345.678', 'V-12345678'],
    ['J-123456', 'J-123456'],
    ['J-123456789', 'J-123456789'],
    ['V-123.456', 'V-123456'],
    ['v12345678', 'V-12345678'],
    ['v 12345678', 'V-12345678'],
    ['\u00A0V-12345678\u2003', 'V-12345678'],
  ])('normaliza %j a %j', (raw, expected) => {
    expect(normalizeNationalId(raw)).toBe(expected)
  })

  it.each([
    [''],
    ['   '],
    ['12345678'],
    ['X-12345678'],
    ['V-12345'],
    ['V-1234567890'],
    ['V--12345678'],
    ['V-1.2345.678'],
    ['V-12.345.6789'],
    ['V-12.345.678.'],
    ['V-12a45678'],
    ['V-'],
    ['V--12-34-56-78'],
    ['\uFEFFV-12345678'],
    ['V-12345678\uFEFF'],
  ])('rechaza %j', (raw) => {
    expect(normalizeNationalId(raw)).toBeNull()
  })
})

