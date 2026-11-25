import type { AppError } from '@/lib/bindings'

export function invalidCredentialsError(): AppError {
  return { code: 'invalidCredentials', message: 'Usuario o contraseña incorrectos', field: null, entityIds: null }
}

export function unauthenticatedError(): AppError {
  return { code: 'unauthenticated', message: 'Inicia sesión para continuar', field: null, entityIds: null }
}

export function forbiddenError(): AppError {
  return { code: 'forbidden', message: 'No tienes permiso para esta acción', field: null, entityIds: null }
}

export function notFoundError(): AppError {
  return { code: 'notFound', message: 'Cliente no encontrado', field: null, entityIds: null }
}

export function nationalIdTakenError(): AppError {
  return { code: 'nationalIdTaken', message: 'Ya existe un cliente con esa cédula', field: 'nationalId', entityIds: null }
}

export function clientDeletedReactivateError(clientId: number): AppError {
  return {
    code: 'clientDeletedReactivate',
    message: 'Ya existió un cliente eliminado con esa cédula. ¿Reactivarlo?',
    field: 'nationalId',
    entityIds: [clientId],
  }
}

export function validationError(field: string): AppError {
  return { code: 'validation', message: 'Revisa el dato ingresado', field, entityIds: null }
}

const REFERENCE_MISSING_MESSAGES = {
  clientId: 'El cliente no existe',
  serviceId: 'El servicio no existe',
  resourceId: 'El recurso no existe',
} as const

export function referenceMissingError(field: keyof typeof REFERENCE_MISSING_MESSAGES): AppError {
  return { code: 'notFound', message: REFERENCE_MISSING_MESSAGES[field], field, entityIds: null }
}

export function appointmentNotFoundError(): AppError {
  return { code: 'notFound', message: 'La cita no existe', field: null, entityIds: null }
}

export function overlapError(conflictingIds: number[]): AppError {
  return {
    code: 'overlap',
    message: 'El recurso ya tiene una cita en ese horario',
    field: 'startsAt',
    entityIds: conflictingIds,
  }
}

export function crossesMidnightError(): AppError {
  return {
    code: 'crossesMidnight',
    message: 'La cita no puede terminar después de la medianoche',
    field: 'startsAt',
    entityIds: null,
  }
}

export function invalidTransitionError(): AppError {
  return {
    code: 'invalidTransition',
    message: 'La cita no admite esa operación en su estado actual',
    field: null,
    entityIds: null,
  }
}

export function resourceInactiveError(): AppError {
  return { code: 'resourceInactive', message: 'El recurso está inactivo', field: 'resourceId', entityIds: null }
}

export function resourceHasFutureAppointmentsError(appointmentIds: number[]): AppError {
  return {
    code: 'resourceHasFutureAppointments',
    message: 'El recurso tiene citas futuras que deben reubicarse antes de desactivarlo',
    field: null,
    entityIds: appointmentIds,
  }
}
