const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const CODE_LENGTH = 20
const GROUP_SIZE = 4
const CHAR_STRIDE = 7
const ROTATION_STRIDE = 5

export function canonicalRecoveryCode(rotation: number): string {
  return Array.from(
    { length: CODE_LENGTH },
    (_, position) => ALPHABET[(position * CHAR_STRIDE + rotation * ROTATION_STRIDE + 1) % ALPHABET.length],
  ).join('')
}

export function formatRecoveryCode(rotation: number): string {
  const groups = canonicalRecoveryCode(rotation).match(new RegExp(`.{${GROUP_SIZE}}`, 'g')) ?? []
  return groups.join('-')
}

export function normalizeRecoveryCode(typed: string): string {
  return typed.replace(/[ -]/g, '').toUpperCase()
}
