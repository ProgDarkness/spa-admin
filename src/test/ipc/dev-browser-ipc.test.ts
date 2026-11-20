import { invoke } from '@tauri-apps/api/core'
import { clearMocks } from '@tauri-apps/api/mocks'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEV_PASSWORD } from '@/test/ipc/auth-backend'
import { commit, getState, resetStore } from '@/lib/mock/store'
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

  it('responde setup_status sin primer arranque pendiente y registra la actividad', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    installDevBrowserIpc()

    await expect(invoke('setup_status')).resolves.toEqual({ needsOwner: false, clockRollback: null })
    await expect(invoke('record_activity')).resolves.toBeNull()
  })

  it('setup_owner con usuarios existentes agrega nada y falla forbidden', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    installDevBrowserIpc()
    const before = getState().users

    await expect(invoke('setup_owner', { input: { username: 'x', password: 'una-clave-larga' } })).rejects.toMatchObject({
      code: 'forbidden',
    })
    expect(getState().users).toBe(before)
  })

  it('setup_owner sobre un store vacío agrega la propietaria al mock', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    commit({ ...getState(), users: [] })
    installDevBrowserIpc()

    await invoke('setup_owner', { input: { username: 'dueña', password: 'una-clave-larga' } })

    expect(getState().users.map((user) => user.username)).toEqual(['dueña'])
    expect(getState().sessionUserId).toBe(getState().users[0]?.id)
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
