import { describe, expect, it } from 'vitest'
import {
  collapseAsciiSpaces,
  countCodePoints,
  hasDisallowedTextCharacter,
  normalizeDisplayText,
  trimUnicodeWhitespace,
} from './text'

const FORMAT_CHARACTER_SAMPLES = [
  '­', '؀', '؅', '؜', '۝', '܏', '࢐', '࢑', '࣢', '᠎', '​', '‏',
  '‪', '‮', '⁠', '⁤', '⁦', '⁯', '﻿', '￹', '￻', '\u{110BD}', '\u{110CD}',
  '\u{13430}', '\u{1343F}', '\u{1BCA0}', '\u{1BCA3}', '\u{1D173}', '\u{1D17A}', '\u{E0001}', '\u{E0020}', '\u{E007F}',
]
const SEPARATOR_SAMPLES = [' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', '　']
const CONTROL_SAMPLES = ['\u0000', '\t', '\n', '\u007F', '\u0085', '\u009F']
const ALLOWED_SAMPLES = ['a', 'Z', ' ', 'ñ', 'é', '✨', '😀', '¬', '®', '⁥', '⁰', '￼', '\u{E0000}', '\u{E0080}']

function codePointLabel(character: string): string {
  return `U+${(character.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`
}

describe('hasDisallowedTextCharacter', () => {
  it.each([...FORMAT_CHARACTER_SAMPLES, ...SEPARATOR_SAMPLES, ...CONTROL_SAMPLES].map((c) => [codePointLabel(c), c]))(
    'rechaza %s',
    (_label, character) => {
      expect(hasDisallowedTextCharacter(`a${character}b`)).toBe(true)
    },
  )

  it.each(ALLOWED_SAMPLES.map((c) => [codePointLabel(c), c]))('permite %s', (_label, character) => {
    expect(hasDisallowedTextCharacter(`a${character}b`)).toBe(false)
  })

  it('no conserva estado entre llamadas', () => {
    expect([1, 2, 3].map(() => hasDisallowedTextCharacter('a​b'))).toEqual([true, true, true])
  })
})

describe('trimUnicodeWhitespace', () => {
  it('recorta White_Space en ambos bordes, incluido U+0085 y U+3000', () => {
    expect(trimUnicodeWhitespace('\u0085　 Sala  \t')).toBe('Sala')
  })

  it('no recorta U+FEFF, que no es White_Space', () => {
    expect(trimUnicodeWhitespace('﻿Sala')).toBe('﻿Sala')
  })

  it('conserva los espacios internos', () => {
    expect(trimUnicodeWhitespace(' a  b ')).toBe('a  b')
  })

  it('devuelve vacío para solo espacios', () => {
    expect(trimUnicodeWhitespace(' \u0085 ')).toBe('')
  })
})

describe('collapseAsciiSpaces', () => {
  it.each([
    ['a  b', 'a b'],
    ['a   b', 'a b'],
    ['a b', 'a b'],
    ['  a', ' a'],
  ])('%j -> %j', (input, expected) => {
    expect(collapseAsciiSpaces(input)).toBe(expected)
  })
})

describe('countCodePoints', () => {
  it('cuenta code points y no unidades UTF-16', () => {
    expect(countCodePoints('😀😀')).toBe(2)
    expect(countCodePoints('')).toBe(0)
  })
})

describe('normalizeDisplayText', () => {
  it('recorta, compone a NFC y colapsa espacios ASCII', () => {
    expect(normalizeDisplayText('  Café   con  leche ')).toBe('Café con leche')
  })
})
