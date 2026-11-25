import { settle } from './ipc'
import type { Result } from './model'

export type InactiveFilter = Readonly<{ includeInactive: boolean }>

export type MirrorSync = Readonly<{
  list: <T>(operation: () => Promise<Result<T>>, replace: (data: T) => void) => Promise<Result<T>>
  reflectMutation: <T>(reflect: (data: T) => void) => (data: T) => void
}>

export function createMirrorSync(): MirrorSync {
  let clock = 0
  let lastAppliedList = 0
  let lastMutation = 0

  return {
    async list(operation, replace) {
      clock += 1
      const ticket = clock
      const result = await settle(operation)
      const isCurrent = ticket > lastAppliedList && ticket > lastMutation
      if (result.status === 'ok' && isCurrent) {
        lastAppliedList = ticket
        replace(result.data)
      }
      return result
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
