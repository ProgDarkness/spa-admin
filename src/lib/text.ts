const DISALLOWED_TEXT_CHARACTER = new RegExp(
  [
    '\\p{Cc}',
    '[\\u00AD\\u0600-\\u0605\\u061C\\u06DD\\u070F\\u0890\\u0891\\u08E2\\u180E\\u200B-\\u200F\\u202A-\\u202E]',
    '[\\u2060-\\u2064\\u2066-\\u206F\\uFEFF\\uFFF9-\\uFFFB\\u{110BD}\\u{110CD}\\u{13430}-\\u{1343F}]',
    '[\\u{1BCA0}-\\u{1BCA3}\\u{1D173}-\\u{1D17A}\\u{E0001}\\u{E0020}-\\u{E007F}]',
    '[\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000]',
  ].join('|'),
  'u',
)

const EDGE_WHITESPACE = /^\p{White_Space}+|\p{White_Space}+$/gu
const REPEATED_ASCII_SPACE = / {2,}/g

export function hasDisallowedTextCharacter(text: string): boolean {
  return DISALLOWED_TEXT_CHARACTER.test(text)
}

export function trimUnicodeWhitespace(text: string): string {
  return text.replace(EDGE_WHITESPACE, '')
}

export function collapseAsciiSpaces(text: string): string {
  return text.replace(REPEATED_ASCII_SPACE, ' ')
}

export function countCodePoints(text: string): number {
  return [...text].length
}

export function normalizeDisplayText(raw: string): string {
  return collapseAsciiSpaces(trimUnicodeWhitespace(raw).normalize('NFC'))
}
