import type { Result } from './model'
import { err } from './result'

const INTERNAL_MESSAGE = 'No se pudo completar la operación'

export async function settle<T>(operation: () => Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await operation()
  } catch {
    return err('internal', INTERNAL_MESSAGE)
  }
}

export async function callBackend<T>(
  operation: () => Promise<Result<T>>,
  reflectInMock: (data: T) => void,
): Promise<Result<T>> {
  const result = await settle(operation)
  if (result.status === 'ok') reflectInMock(result.data)
  return result
}
