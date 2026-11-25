import { describe, expect, it } from 'vitest'
import {
  clientDeletedReactivateError,
  forbiddenError,
  invalidCredentialsError,
  nationalIdTakenError,
  notFoundError,
  unauthenticatedError,
  validationError,
} from './ipc-errors'

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

  it('notFound usa el mensaje fijo de Rust y no lleva campo', () => {
    expect(notFoundError()).toEqual({ code: 'notFound', message: 'Cliente no encontrado', field: null, entityIds: null })
  })

  it('nationalIdTaken señala el campo nationalId', () => {
    expect(nationalIdTakenError()).toEqual({
      code: 'nationalIdTaken',
      message: 'Ya existe un cliente con esa cédula',
      field: 'nationalId',
      entityIds: null,
    })
  })

  it('clientDeletedReactivate lleva el id del cliente eliminado', () => {
    expect(clientDeletedReactivateError(9)).toEqual({
      code: 'clientDeletedReactivate',
      message: 'Ya existió un cliente eliminado con esa cédula. ¿Reactivarlo?',
      field: 'nationalId',
      entityIds: [9],
    })
  })

  it('devuelve objetos nuevos en cada llamada', () => {
    expect(invalidCredentialsError()).not.toBe(invalidCredentialsError())
  })
})
