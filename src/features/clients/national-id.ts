import { trimUnicodeWhitespace } from '@/lib/text'

const NATIONAL_ID_PREFIXES = ['V', 'E', 'J']
const NATIONAL_ID_DIGITS = { min: 6, max: 9 }
const THOUSANDS_GROUP_DIGITS = 3
const ASCII_DIGITS = /^[0-9]+$/

function hasThousandsGrouping(body: string): boolean {
  const [first = '', ...rest] = body.split('.')
  const firstIsValid = ASCII_DIGITS.test(first) && first.length <= THOUSANDS_GROUP_DIGITS
  return firstIsValid && rest.every((group) => ASCII_DIGITS.test(group) && group.length === THOUSANDS_GROUP_DIGITS)
}

function plainDigits(body: string): string | null {
  const wellFormed = body.includes('.') ? hasThousandsGrouping(body) : ASCII_DIGITS.test(body)
  return wellFormed ? body.replaceAll('.', '') : null
}

function withoutSeparator(rest: string): string {
  if (rest.startsWith('-') || rest.startsWith(' ')) return rest.slice(1)
  return rest
}

export function normalizeNationalId(raw: string): string | null {
  const [first = '', ...others] = [...trimUnicodeWhitespace(raw)]
  const prefix = first.toUpperCase()
  if (!NATIONAL_ID_PREFIXES.includes(prefix)) return null
  const digits = plainDigits(withoutSeparator(others.join('')))
  if (digits === null) return null
  const isLengthValid = digits.length >= NATIONAL_ID_DIGITS.min && digits.length <= NATIONAL_ID_DIGITS.max
  return isLengthValid ? `${prefix}-${digits}` : null
}
