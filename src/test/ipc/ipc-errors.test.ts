import { describe, expect, it } from 'vitest'
import {
  appointmentNotFoundError,
  clientDeletedReactivateError,
  crossesMidnightError,
  forbiddenError,
  invalidCredentialsError,
  invalidTransitionError,
  nationalIdTakenError,
  notFoundError,
  overlapError,
  referenceMissingError,
  resourceHasFutureAppointmentsError,
  resourceInactiveError,
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

  it('los errores de citas replican código, campo, entityIds y mensaje de Rust', () => {
    expect(overlapError([3, 4])).toEqual({
      code: 'overlap',
      message: 'El recurso ya tiene una cita en ese horario',
      field: 'startsAt',
      entityIds: [3, 4],
    })
    expect(crossesMidnightError()).toEqual({
      code: 'crossesMidnight',
      message: 'La cita no puede terminar después de la medianoche',
      field: 'startsAt',
      entityIds: null,
    })
    expect(invalidTransitionError()).toEqual({
      code: 'invalidTransition',
      message: 'La cita no admite esa operación en su estado actual',
      field: null,
      entityIds: null,
    })
    expect(resourceInactiveError()).toEqual({
      code: 'resourceInactive',
      message: 'El recurso está inactivo',
      field: 'resourceId',
      entityIds: null,
    })
    expect(resourceHasFutureAppointmentsError([5])).toEqual({
      code: 'resourceHasFutureAppointments',
      message: 'El recurso tiene citas futuras que deben reubicarse antes de desactivarlo',
      field: null,
      entityIds: [5],
    })
    expect(appointmentNotFoundError()).toEqual({
      code: 'notFound',
      message: 'La cita no existe',
      field: null,
      entityIds: null,
    })
  })

  it('referenceMissing elige el mensaje por campo', () => {
    expect(referenceMissingError('clientId')).toMatchObject({ code: 'notFound', field: 'clientId', message: 'El cliente no existe' })
    expect(referenceMissingError('serviceId')).toMatchObject({ field: 'serviceId', message: 'El servicio no existe' })
    expect(referenceMissingError('resourceId')).toMatchObject({ field: 'resourceId', message: 'El recurso no existe' })
  })

  it('devuelve objetos nuevos en cada llamada', () => {
    expect(invalidCredentialsError()).not.toBe(invalidCredentialsError())
  })
})
