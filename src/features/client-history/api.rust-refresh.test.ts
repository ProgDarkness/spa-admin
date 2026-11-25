import { clearMocks } from '@tauri-apps/api/mocks'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listServices } from '@/features/catalog/api'
import { listResources } from '@/features/resources/api'
import { getState, resetStore } from '@/lib/mock/store'
import { freezeDate } from '@/test/clock'
import { stubRustCatalog } from '@/test/rust-backend-stub'
import { signInAs } from '@/test/session'
import { getClientHistory } from './api'

const JOSE_ID = 2
const INACTIVE_SERVICE_NAME = 'Peeling químico (ejemplo)'
const INACTIVE_RESOURCE_NAME = 'Manicure (Rosa)'

async function entriesOfJose() {
  const history = await getClientHistory(JOSE_ID)
  if (history.status !== 'ok') throw new Error('se esperaba ok')
  return history.data.entries
}

beforeEach(() => {
  freezeDate('2026-11-12T09:00')
  resetStore()
  signInAs('recepcion')
  stubRustCatalog({ services: getState().services, resources: getState().resources })
})
afterEach(() => clearMocks())

describe('getClientHistory tras listar solo activos', () => {
  it('conserva el nombre del servicio inactivo con cita pasada', async () => {
    await listServices({ includeInactive: false })

    expect((await entriesOfJose()).map((entry) => entry.serviceName)).toContain(INACTIVE_SERVICE_NAME)
  })

  it('conserva el nombre del recurso inactivo con cita pasada', async () => {
    await listResources({ includeInactive: false })

    expect((await entriesOfJose()).map((entry) => entry.resourceName)).toContain(INACTIVE_RESOURCE_NAME)
  })
})
