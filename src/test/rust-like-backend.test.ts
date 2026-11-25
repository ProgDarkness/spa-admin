import { invoke } from '@tauri-apps/api/core'
import { describe, expect, it } from 'vitest'
import { DEV_PASSWORD } from './ipc/auth-backend'
import { installRustLikeBackend } from './rust-like-backend'

const OWNER_CREDENTIALS = { credentials: { username: 'propietaria', password: DEV_PASSWORD } }

describe('installRustLikeBackend', () => {
  it('autentica contra sus propios usuarios y lista los datos sembrados', async () => {
    installRustLikeBackend()

    await invoke('login', OWNER_CREDENTIALS)
    const clients = (await invoke('list_clients', { filter: { query: '', includeDeleted: true } })) as unknown[]

    expect(clients.length).toBeGreaterThan(0)
  })

  it('aplica los datos sustituidos y conserva los usuarios', async () => {
    installRustLikeBackend({ dataOverrides: { clients: [] } })

    await invoke('login', OWNER_CREDENTIALS)
    const clients = (await invoke('list_clients', { filter: { query: '', includeDeleted: true } })) as unknown[]

    expect(clients).toEqual([])
  })

  it('rechaza los comandos sin sesión', async () => {
    installRustLikeBackend()

    await expect(invoke('list_clients', { filter: { query: '', includeDeleted: true } })).rejects.toMatchObject({
      code: 'unauthenticated',
    })
  })
})
