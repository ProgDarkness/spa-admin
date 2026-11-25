import { invoke } from '@tauri-apps/api/core'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetStore } from '@/lib/mock/store'
import { DEV_PASSWORD } from './auth-backend'
import {
  clientIdentitiesOf,
  EXPECTED_DEV_CLIENTS,
  EXPECTED_DEV_RESOURCES,
  EXPECTED_DEV_SERVICES,
  resourceIdentitiesOf,
  serviceIdentitiesOf,
} from './dev-seed-expectations'

const LIST_ALL = { filter: { includeInactive: true } }

beforeEach(async () => {
  resetStore()
  await invoke('login', { credentials: { username: 'propietaria', password: DEV_PASSWORD } })
})

describe('backend IPC global de vitest', () => {
  it('lista los tres recursos del seed con nombre, kind y estado', async () => {
    expect(resourceIdentitiesOf(await invoke('list_resources', LIST_ALL))).toEqual(EXPECTED_DEV_RESOURCES)
  })

  it('lista los nueve clientes del seed con el noveno eliminado', async () => {
    const clients = await invoke('list_clients', { filter: { query: '', includeDeleted: true } })

    expect(clientIdentitiesOf(clients)).toEqual(EXPECTED_DEV_CLIENTS)
  })

  it('lista los servicios del seed con id y nombre', async () => {
    expect(serviceIdentitiesOf(await invoke('list_services', LIST_ALL))).toEqual(EXPECTED_DEV_SERVICES)
  })
})
