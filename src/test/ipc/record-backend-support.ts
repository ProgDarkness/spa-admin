import type { SessionUser } from '@/lib/model'
import { countCodePoints, hasDisallowedTextCharacter, normalizeDisplayText } from '@/lib/text'
import { forbiddenError, unauthenticatedError } from './ipc-errors'

export type Fields = Record<string, unknown>

const MAX_RECORD_NAME_CHARS = 80

export function isRecord(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null
}

export function payloadOf(args: unknown, key: string): Fields {
  const payload = isRecord(args) ? args[key] : undefined
  if (!isRecord(payload)) throw new Error(`argumento inválido: ${key}`)
  return payload
}

export function booleanField(fields: Fields, key: string): boolean {
  const value = fields[key]
  if (typeof value !== 'boolean') throw new Error(`argumento inválido: ${key}`)
  return value
}

export function normalizedRecordName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const name = normalizeDisplayText(raw)
  const length = countCodePoints(name)
  if (length < 1 || length > MAX_RECORD_NAME_CHARS) return null
  return hasDisallowedTextCharacter(name) ? null : name
}

export function recordNameKey(name: string): string {
  return name.normalize('NFKC').normalize('NFC').toLowerCase().normalize('NFC')
}

export function requirePermission(session: () => SessionUser | null, ...accepted: string[]): void {
  const user = session()
  if (!user) throw unauthenticatedError()
  if (!accepted.some((permission) => user.permissions.some((granted) => granted === permission))) {
    throw forbiddenError()
  }
}

export function toInstant(ms: number): string {
  return new Date(ms).toISOString()
}

export function nextRecordId(rows: readonly { id: number }[]): number {
  return rows.reduce((highest, row) => Math.max(highest, row.id), 0) + 1
}

export function replaceRecord<T extends { id: number }>(rows: readonly T[], updated: T): readonly T[] {
  return rows.map((row) => (row.id === updated.id ? updated : row))
}
