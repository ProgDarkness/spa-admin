import { countCodePoints, trimUnicodeWhitespace } from '@/lib/text'

const PHONE_DIGITS = { min: 7, max: 15 }
const PHONE_MAX_CHARACTERS = 32
const QUERY_MAX_CHARACTERS = 100
const ASCII_DIGITS = /^[0-9]+$/
const CONTROL_CHARACTER = /\p{Cc}/u
const WHITESPACE_RUN = /\p{White_Space}+/u
const PHONE_BODY = /^[0-9 -]*$/
const COMBINING_MARKS = /\p{M}/gu
const IDENTIFIER_SEPARATORS = new Set([' ', '.', '-'])
const SEARCH_PREFIX_LETTERS = ['v', 'e', 'j']

type SearchableClient = Readonly<{ firstName: string; lastName: string; nationalId: string; phone: string }>

function digitsOf(text: string): string {
  return text.replace(/[^0-9]/g, '')
}

export function validPhone(raw: string): string | null {
  if (CONTROL_CHARACTER.test(raw)) return null
  const phone = raw.split(WHITESPACE_RUN).filter(Boolean).join(' ')
  const body = phone.startsWith('+') ? phone.slice(1) : phone
  const digitCount = digitsOf(body).length
  const isDigitCountValid = digitCount >= PHONE_DIGITS.min && digitCount <= PHONE_DIGITS.max
  const fits = countCodePoints(phone) <= PHONE_MAX_CHARACTERS
  return fits && PHONE_BODY.test(body) && isDigitCountValid ? phone : null
}

function foldText(text: string): string {
  return text.normalize('NFD').replace(COMBINING_MARKS, '').toLowerCase()
}

function compactIdentifier(text: string): string {
  return [...foldText(text)].filter((character) => !IDENTIFIER_SEPARATORS.has(character)).join('')
}

export function searchKeyOf({ firstName, lastName, nationalId, phone }: SearchableClient): string {
  return [
    foldText(firstName),
    foldText(lastName),
    foldText(nationalId),
    compactIdentifier(nationalId),
    foldText(phone),
    digitsOf(phone),
  ].join(' ')
}

function isIdentifierShaped(folded: string): boolean {
  const body = folded.startsWith('+') ? folded.slice(1) : folded
  const [first = '', ...rest] = [...body]
  const digitsStart = SEARCH_PREFIX_LETTERS.includes(first) ? rest : [...body]
  const isDigitOrSeparator = (character: string) => ASCII_DIGITS.test(character) || IDENTIFIER_SEPARATORS.has(character)
  return digitsStart.every(isDigitOrSeparator) && digitsStart.some((character) => ASCII_DIGITS.test(character))
}

export function searchTermOf(query: string): string {
  const folded = [...foldText(trimUnicodeWhitespace(query))].slice(0, QUERY_MAX_CHARACTERS).join('')
  if (!isIdentifierShaped(folded)) return folded
  return [...folded].filter((character) => character !== '+' && !IDENTIFIER_SEPARATORS.has(character)).join('')
}
