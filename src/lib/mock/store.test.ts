import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { freezeDate } from '@/test/clock'
import { findRuntimeSeedImports } from '@/test/seed-import-guard'
import { createSeed } from './seed'
import { appendRow, commit, findById, getState, nextId, replaceById, resetStore, upsertById } from './store'

beforeEach(() => {
  freezeDate('2026-11-12T09:00')
  resetStore()
})

describe('estado inicial sin siembra inyectada', () => {
  it('arranca vacío, sin sesión y sin importar el seed', async () => {
    vi.resetModules()
    const fresh = await import('./store')

    expect(fresh.getState()).toEqual({
      users: [],
      sessionUserId: null,
      clients: [],
      services: [],
      resources: [],
      paymentMethods: [],
      rates: [],
      appointments: [],
      payments: [],
    })
    fresh.resetStore()
    expect(fresh.getState().clients).toEqual([])
  })

  it('el módulo del store no referencia el seed', () => {
    const source = readFileSync(join(process.cwd(), 'src/lib/mock/store.ts'), 'utf8')

    expect(findRuntimeSeedImports(source)).toEqual([])
    expect(source).not.toContain('createSeed')
  })
})

describe('getState / resetStore', () => {
  it('arranca con el seed de la fecha local actual y sin sesión', () => {
    expect(getState()).toEqual(createSeed('2026-11-12'))
    expect(getState().sessionUserId).toBeNull()
  })

  it('resetStore restaura el seed tras una mutación', () => {
    const mutated = { ...getState(), clients: [] }
    commit(mutated)
    expect(getState().clients).toHaveLength(0)
    resetStore()
    expect(getState().clients.length).toBeGreaterThan(0)
    expect(getState()).toEqual(createSeed('2026-11-12'))
  })

  it('resetStore usa la fecha congelada vigente', () => {
    freezeDate('2026-12-20T09:00')
    resetStore()
    expect(getState()).toEqual(createSeed('2026-12-20'))
  })
})

describe('commit', () => {
  it('reemplaza la referencia sin mutar el estado previo', () => {
    const previous = getState()
    const previousClients = previous.clients
    const next = { ...previous, sessionUserId: 2 }
    const committed = commit(next)
    expect(committed).toBe(next)
    expect(getState()).toBe(next)
    expect(previous.sessionUserId).toBeNull()
    expect(previous.clients).toBe(previousClients)
  })
})

describe('nextId', () => {
  it('devuelve 1 para colecciones vacías', () => {
    expect(nextId([])).toBe(1)
  })

  it('devuelve máximo + 1 aunque haya huecos y desorden', () => {
    expect(nextId([{ id: 3 }, { id: 9 }, { id: 4 }])).toBe(10)
  })

  it('es consistente con el seed', () => {
    const { clients } = getState()
    expect(nextId(clients)).toBe(Math.max(...clients.map((client) => client.id)) + 1)
  })
})

describe('findById', () => {
  const rows = [{ id: 1, name: 'a' }, { id: 2, name: 'b' }]

  it('encuentra la fila', () => {
    expect(findById(rows, 2)).toBe(rows[1])
  })

  it('devuelve undefined si no existe', () => {
    expect(findById(rows, 7)).toBeUndefined()
  })
})

describe('replaceById', () => {
  it('devuelve una colección nueva con la fila reemplazada', () => {
    const rows = [{ id: 1, name: 'a' }, { id: 2, name: 'b' }]
    const next = replaceById(rows, { id: 2, name: 'z' })
    expect(next).toEqual([{ id: 1, name: 'a' }, { id: 2, name: 'z' }])
    expect(next).not.toBe(rows)
    expect(rows[1]).toEqual({ id: 2, name: 'b' })
    expect(next[0]).toBe(rows[0])
  })

  it('si el id no existe deja las filas iguales en una copia', () => {
    const rows = [{ id: 1, name: 'a' }]
    const next = replaceById(rows, { id: 5, name: 'x' })
    expect(next).toEqual(rows)
    expect(next).not.toBe(rows)
  })
})

describe('appendRow', () => {
  it('devuelve una colección nueva con la fila al final', () => {
    const rows = [1, 2]
    const next = appendRow(rows, 3)
    expect(next).toEqual([1, 2, 3])
    expect(rows).toEqual([1, 2])
    expect(next).not.toBe(rows)
  })
})

describe('upsertById', () => {
  const rows = [
    { id: 1, name: 'a' },
    { id: 2, name: 'b' },
  ]

  it('reemplaza en su posición la fila con el mismo id sin mutar el original', () => {
    const next = upsertById(rows, { id: 1, name: 'z' })

    expect(next).toEqual([
      { id: 1, name: 'z' },
      { id: 2, name: 'b' },
    ])
    expect(rows[0]?.name).toBe('a')
    expect(next[1]).toBe(rows[1])
  })

  it('agrega al final la fila con id nuevo', () => {
    const next = upsertById(rows, { id: 7, name: 'n' })

    expect(next).toEqual([...rows, { id: 7, name: 'n' }])
    expect(next).not.toBe(rows)
  })
})
