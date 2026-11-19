import type { AppError } from '@/lib/model'
import { PASSWORD_TOO_SHORT_MESSAGE } from './schemas'

const VALIDATION_TEXT_BY_FIELD: ReadonlyMap<string, string> = new Map([
  ['password', PASSWORD_TOO_SHORT_MESSAGE],
  ['username', 'Revisa el usuario ingresado'],
])

const SESSION_NOT_LOCKED_TEXT = 'La sesión ya no está bloqueada'

export function unlockErrorTextOf(error: AppError): string {
  if (error.code === 'validation' && error.field === 'password') return SESSION_NOT_LOCKED_TEXT
  return errorTextOf(error)
}

export function errorTextOf(error: AppError): string {
  if (error.code !== 'validation' || error.field === null) return error.message
  return VALIDATION_TEXT_BY_FIELD.get(error.field) ?? error.message
}
