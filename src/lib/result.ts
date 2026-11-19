import type { z } from 'zod'
import type { AppError, AppErrorCode, Id, Result } from './model'

const GENERIC_VALIDATION_MESSAGE = 'Datos inválidos'

type ErrorDetails = { field?: string; entityIds?: readonly Id[] }

export function ok<T>(data: T): Result<T> {
  return { status: 'ok', data }
}

export function err<T = never>(code: AppErrorCode, message: string, details?: ErrorDetails): Result<T> {
  return {
    status: 'error',
    error: {
      code,
      message,
      field: details?.field ?? null,
      entityIds: details?.entityIds ? [...details.entityIds] : null,
    },
  }
}

export function validationError<T = never>(issues: readonly z.core.$ZodIssue[]): Result<T> {
  const firstIssue = issues[0]
  const pathSegments = firstIssue?.path.map(String) ?? []
  return err('validation', firstIssue?.message ?? GENERIC_VALIDATION_MESSAGE, {
    ...(pathSegments.length > 0 ? { field: pathSegments.join('.') } : {}),
  })
}

export class AppErrorException extends Error {
  readonly appError: AppError

  constructor(appError: AppError) {
    super(appError.message)
    this.name = 'AppErrorException'
    this.appError = appError
  }
}

export function unwrap<T>(result: Result<T>): T {
  if (result.status === 'ok') return result.data
  throw new AppErrorException(result.error)
}

export function appErrorOf(caught: unknown): AppError | null {
  return caught instanceof AppErrorException ? caught.appError : null
}

export const UNEXPECTED_ERROR: AppError = {
  code: 'validation',
  message: 'No se pudo completar la operación',
  field: null,
  entityIds: null,
}

export async function failureOf(operation: () => Promise<unknown>): Promise<AppError | null> {
  try {
    await operation()
    return null
  } catch (caught) {
    return appErrorOf(caught) ?? UNEXPECTED_ERROR
  }
}
