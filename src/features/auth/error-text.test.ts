import { describe, expect, it } from 'vitest'
import type { AppError } from '@/lib/model'
import { errorTextOf, unlockErrorTextOf } from './error-text'

function error(overrides: Partial<AppError>): AppError {
  return { code: 'validation', message: 'Revisa el dato ingresado', field: null, entityIds: null, ...overrides }
}

describe('errorTextOf', () => {
  it('traduce la validación del campo password', () => {
    expect(errorTextOf(error({ field: 'password' }))).toBe('La contraseña debe tener al menos 10 caracteres')
  })

  it('traduce la validación del campo username', () => {
    expect(errorTextOf(error({ field: 'username' }))).toBe('Revisa el usuario ingresado')
  })

  it('usa el mensaje del backend para campos desconocidos y para otros códigos', () => {
    expect(errorTextOf(error({ field: 'otro' }))).toBe('Revisa el dato ingresado')
    expect(errorTextOf(error({ code: 'invalidCredentials', message: 'Usuario o contraseña incorrectos' }))).toBe(
      'Usuario o contraseña incorrectos',
    )
  })

  it('unlock_validation_error_does_not_mention_password_length', () => {
    const text = unlockErrorTextOf(error({ field: 'password' }))

    expect(text).toBe('La sesión ya no está bloqueada')
    expect(text).not.toMatch(/10 caracteres/)
  })

  it('unlockErrorTextOf delega en errorTextOf para el resto de errores', () => {
    expect(unlockErrorTextOf(error({ code: 'invalidCredentials', message: 'Usuario o contraseña incorrectos' }))).toBe(
      'Usuario o contraseña incorrectos',
    )
    expect(unlockErrorTextOf(error({ field: 'username' }))).toBe('Revisa el usuario ingresado')
  })

  it('no traduce el campo si el código no es validation', () => {
    expect(errorTextOf(error({ code: 'forbidden', message: 'No tienes permiso', field: 'password' }))).toBe(
      'No tienes permiso',
    )
  })
})
