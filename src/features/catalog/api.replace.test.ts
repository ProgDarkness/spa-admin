import { clearMocks, mockIPC } from '@tauri-apps/api/mocks'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ServiceSummary } from '@/lib/bindings'
import { getState, resetStore } from '@/lib/mock/store'
import { createService, listServices } from './api'

const INSTANT = '2026-11-12T09:00:00Z'
const ALL = { includeInactive: true }

function summary(overrides: Partial<ServiceSummary>): ServiceSummary {
  return {
    id: 1,
    name: 'Servicio real',
    priceCents: 4_200,
    currency: 'USD',
    durationMin: 45,
    active: true,
    createdAt: INSTANT,
    updatedAt: INSTANT,
    ...overrides,
  }
}

function rustReturns(rows: readonly ServiceSummary[]): void {
  mockIPC((cmd) => (cmd === 'list_services' ? rows : null))
}

beforeEach(resetStore)
afterEach(() => clearMocks())

describe('listServices reemplaza el espejo', () => {
  it('deja en el store exactamente lo que devuelve Rust', async () => {
    rustReturns([summary({ id: 1 }), summary({ id: 77, name: 'Otro real' })])

    await listServices(ALL)

    expect(getState().services.map((service) => [service.id, service.name])).toEqual([
      [1, 'Servicio real'],
      [77, 'Otro real'],
    ])
  })

  it('vacía el store cuando Rust no devuelve servicios', async () => {
    rustReturns([])

    await listServices(ALL)

    expect(getState().services).toEqual([])
  })

  it('create sigue haciendo upsert sin tocar el resto', async () => {
    const before = getState().services
    mockIPC((cmd) => (cmd === 'create_service' ? summary({ id: 90 }) : null))

    await createService({ name: 'Servicio real', priceCents: 4_200, durationMin: 45 })

    expect(getState().services).toHaveLength(before.length + 1)
    expect(getState().services.find((service) => service.id === 90)?.name).toBe('Servicio real')
  })
})
