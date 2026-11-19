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

export function validationError(field: string): AppError {
  return { code: 'validation', message: 'Revisa el dato ingresado', field, entityIds: null }
}
