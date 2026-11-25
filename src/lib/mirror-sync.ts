import { settle } from './ipc'
import type { Result } from './model'
import { err } from './result'

export type InactiveFilter = Readonly<{ includeInactive: boolean }>

export type MirrorSync = Readonly<{
  list: <T>(operation: () => Promise<Result<T>>, replace: (data: T) => void) => Promise<Result<T>>
  listUntilApplied: <T>(operation: () => Promise<Result<T>>, replace: (data: T) => void) => Promise<Result<T>>
  reflectMutation: <T>(reflect: (data: T) => void) => (data: T) => void
}>

const MAX_SYNC_ATTEMPTS = 3
const SYNC_STALE_MESSAGE = 'No se pudo sincronizar los datos, intenta de nuevo'

export function createMirrorSync(): MirrorSync {
  let clock = 0
  let lastAppliedList = 0
  let lastMutation = 0

  async function attempt<T>(
    operation: () => Promise<Result<T>>,
    replace: (data: T) => void,
  ): Promise<{ result: Result<T>; isApplied: boolean }> {
    clock += 1
    const ticket = clock
    const result = await settle(operation)
    const isCurrent = ticket > lastAppliedList && ticket > lastMutation
    if (result.status === 'ok' && isCurrent) {
      lastAppliedList = ticket
      replace(result.data)
      return { result, isApplied: true }
    }
    return { result, isApplied: false }
  }

  return {
    async list(operation, replace) {
      return (await attempt(operation, replace)).result
    },
    async listUntilApplied(operation, replace) {
      for (let attempts = 0; attempts < MAX_SYNC_ATTEMPTS; attempts += 1) {
        const { result, isApplied } = await attempt(operation, replace)
        if (result.status === 'error' || isApplied) return result
      }
      return err('internal', SYNC_STALE_MESSAGE)
    },
    reflectMutation(reflect) {
      return (data) => {
        clock += 1
        lastMutation = clock
        reflect(data)
      }
    },
  }
}

export function visibleRows<T extends Readonly<{ active: boolean }>>(
  rows: readonly T[],
  filter: InactiveFilter,
): T[] {
  return rows.filter((row) => filter.includeInactive || row.active)
}
