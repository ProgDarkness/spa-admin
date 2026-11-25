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
