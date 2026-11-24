import { clearMocks, mockIPC } from '@tauri-apps/api/mocks'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ResourceSummary } from '@/lib/bindings'
import { getState, resetStore } from '@/lib/mock/store'
import { createResource, listResources } from './api'

const INSTANT = '2026-11-12T09:00:00Z'
const ALL = { includeInactive: true }

function summary(overrides: Partial<ResourceSummary>): ResourceSummary {
  return { id: 1, name: 'Sala real', kind: 'cabin', active: true, createdAt: INSTANT, updatedAt: INSTANT, ...overrides }
}

function rustReturns(rows: readonly ResourceSummary[]): void {
  mockIPC((cmd) => (cmd === 'list_resources' ? rows : null))
}

beforeEach(resetStore)
afterEach(() => clearMocks())

describe('listResources reemplaza el espejo', () => {
  it('deja en el store exactamente lo que devuelve Rust', async () => {
    rustReturns([summary({ id: 1 }), summary({ id: 55, name: 'Otra real' })])

    await listResources(ALL)

    expect(getState().resources.map((resource) => [resource.id, resource.name])).toEqual([
      [1, 'Sala real'],
      [55, 'Otra real'],
    ])
  })

  it('vacía el store cuando Rust no devuelve recursos', async () => {
    rustReturns([])

    await listResources(ALL)

    expect(getState().resources).toEqual([])
  })

  it('create sigue haciendo upsert sin tocar el resto', async () => {
    const before = getState().resources
    mockIPC((cmd) => (cmd === 'create_resource' ? summary({ id: 90 }) : null))

    await createResource({ name: 'Sala real', kind: 'cabin' })

    expect(getState().resources).toHaveLength(before.length + 1)
    expect(getState().resources.find((resource) => resource.id === 90)?.name).toBe('Sala real')
  })
})
