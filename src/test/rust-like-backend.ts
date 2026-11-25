import { mockIPC } from '@tauri-apps/api/mocks'
import { createSeed } from '@/lib/mock/seed'
import type { Id } from '@/lib/model'
import type { StoreState } from '@/lib/mock/store'
import { createAuthIpcBackend } from './ipc/auth-backend'
import { createDevBackends } from './ipc/dev-backends'

const RUST_REFERENCE_DATE = '2026-11-12'

export type RustLikeBackendOptions = { dataOverrides?: Partial<StoreState> }

export function installRustLikeBackend({ dataOverrides = {} }: RustLikeBackendOptions = {}): void {
  const rustSeed: StoreState = { ...createSeed(RUST_REFERENCE_DATE), ...dataOverrides }
  let rustSessionUserId: Id | null = null
  const auth = createAuthIpcBackend(() => rustSeed.users, {
    read: () => rustSessionUserId,
    write: (id) => {
      rustSessionUserId = id
    },
  })
  mockIPC(
    createDevBackends({
      auth,
      session: () => rustSeed.users.find((user) => user.id === rustSessionUserId) ?? null,
      seed: rustSeed,
    }),
  )
}
