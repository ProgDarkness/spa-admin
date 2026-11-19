import { describe, expect, it } from 'vitest'
import { forbiddenError, invalidCredentialsError, unauthenticatedError, validationError } from './ipc-errors'

describe('ipc-errors', () => {
  it('invalidCredentials usa el mensaje fijo de Rust', () => {
    expect(invalidCredentialsError()).toEqual({
      code: 'invalidCredentials',
      message: 'Usuario o contraseña incorrectos',
      field: null,
      entityIds: null,
    })
  })

  it('validation lleva el campo y el mensaje fijo', () => {
    expect(validationError('password')).toEqual({
      code: 'validation',
      message: 'Revisa el dato ingresado',
      field: 'password',
      entityIds: null,
    })
  })

  it('unauthenticated y forbidden no llevan campo', () => {
    expect(unauthenticatedError()).toMatchObject({ code: 'unauthenticated', field: null })
    expect(forbiddenError()).toMatchObject({ code: 'forbidden', field: null })
  })

  it('devuelve objetos nuevos en cada llamada', () => {
    expect(invalidCredentialsError()).not.toBe(invalidCredentialsError())
  })
})
