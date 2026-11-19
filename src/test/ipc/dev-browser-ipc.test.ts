import { invoke } from '@tauri-apps/api/core'
import { clearMocks } from '@tauri-apps/api/mocks'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEV_PASSWORD } from '@/test/ipc/auth-backend'
import { getState, resetStore } from '@/lib/mock/store'
import { installDevBrowserIpc } from './dev-browser-ipc'

type TauriWindow = { __TAURI_INTERNALS__?: unknown }

const OWNER_CREDENTIALS = { credentials: { username: 'propietaria', password: DEV_PASSWORD } }

function internals(): unknown {
  return (window as TauriWindow).__TAURI_INTERNALS__
}

beforeEach(() => {
  resetStore()
  clearMocks()
  delete (window as TauriWindow).__TAURI_INTERNALS__
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('installDevBrowserIpc', () => {
  it('se instala en desarrollo sin internals y permite iniciar sesión con los usuarios de ejemplo', async () => {
    vi.stubEnv('NODE_ENV', 'development')

    const installed = installDevBrowserIpc()

    expect(installed).toBe(true)
    await expect(invoke('login', OWNER_CREDENTIALS)).resolves.toMatchObject({ username: 'propietaria' })
    expect(getState().sessionUserId).toBe(1)
  })

  it('no se instala si ya hay internals de Tauri', () => {
    vi.stubEnv('NODE_ENV', 'development')
    const nativeInternals = { invoke: vi.fn() }
    ;(window as TauriWindow).__TAURI_INTERNALS__ = nativeInternals

    const installed = installDevBrowserIpc()

    expect(installed).toBe(false)
    expect(internals()).toBe(nativeInternals)
  })

  it.each(['production', 'test'])('no se instala con NODE_ENV %s', (nodeEnv) => {
    vi.stubEnv('NODE_ENV', nodeEnv)

    const installed = installDevBrowserIpc()

    expect(installed).toBe(false)
    expect(internals()).toBeUndefined()
  })
})
