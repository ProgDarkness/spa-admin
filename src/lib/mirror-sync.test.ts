import { describe, expect, it } from 'vitest'
import { deferred } from '@/test/deferred'
import { createMirrorSync, visibleRows } from './mirror-sync'
import type { Result } from './model'
import { ok } from './result'

type Row = Readonly<{ id: number; active: boolean }>

function recorder(): { applied: (readonly Row[])[]; replace: (rows: readonly Row[]) => void } {
  const applied: (readonly Row[])[] = []
  return { applied, replace: (rows) => void applied.push(rows) }
}

describe('createMirrorSync.list', () => {
  it('aplica el reemplazo y devuelve los datos cuando nada compite', async () => {
    const sync = createMirrorSync()
    const { applied, replace } = recorder()
    const rows: Row[] = [{ id: 1, active: true }]

    const result = await sync.list(async () => ok(rows), replace)

    expect(result).toEqual(ok(rows))
    expect(applied).toEqual([rows])
  })

  it('no aplica ni devuelve datos de éxito cuando la operación falla', async () => {
    const sync = createMirrorSync()
    const { applied, replace } = recorder()
    const failure: Result<Row[]> = { status: 'error', error: { code: 'internal', message: 'x', field: null, entityIds: null } }

    const result = await sync.list(async () => failure, replace)

    expect(result).toBe(failure)
    expect(applied).toEqual([])
  })

  it('convierte una excepción en error interno sin aplicar', async () => {
    const sync = createMirrorSync()
    const { applied, replace } = recorder()

    const result = await sync.list(async () => Promise.reject(new Error('caído')), replace)

    expect(result.status === 'error' && result.error.code).toBe('internal')
    expect(applied).toEqual([])
  })

  it('descarta el reemplazo de un list en vuelo si una mutación se reflejó después de iniciarlo, pero devuelve sus datos', async () => {
    const sync = createMirrorSync()
    const { applied, replace } = recorder()
    const slow = deferred<Result<Row[]>>()
    const reflected: Row[] = []

    const pending = sync.list(() => slow.promise, replace)
    sync.reflectMutation((row: Row) => void reflected.push(row))({ id: 9, active: true })
    slow.resolve(ok([{ id: 1, active: true }]))
    const result = await pending

    expect(reflected).toEqual([{ id: 9, active: true }])
    expect(applied).toEqual([])
    expect(result).toEqual(ok([{ id: 1, active: true }]))
  })

  it('aplica un list iniciado después de la mutación', async () => {
    const sync = createMirrorSync()
    const { applied, replace } = recorder()
    sync.reflectMutation(() => undefined)(null)

    await sync.list(async () => ok([{ id: 1, active: true }]), replace)

    expect(applied).toHaveLength(1)
  })

  it('con dos list fuera de orden gana el más reciente', async () => {
    const sync = createMirrorSync()
    const { applied, replace } = recorder()
    const older = deferred<Result<Row[]>>()
    const newer = deferred<Result<Row[]>>()
    const olderRows: Row[] = [{ id: 1, active: true }]
    const newerRows: Row[] = [{ id: 2, active: true }]

    const olderPending = sync.list(() => older.promise, replace)
    const newerPending = sync.list(() => newer.promise, replace)
    newer.resolve(ok(newerRows))
    await newerPending
    older.resolve(ok(olderRows))
    const olderResult = await olderPending

    expect(applied).toEqual([newerRows])
    expect(olderResult).toEqual(ok(olderRows))
  })

  it('aplica en orden cuando los list responden en el orden de inicio', async () => {
    const sync = createMirrorSync()
    const { applied, replace } = recorder()

    await sync.list(async () => ok([{ id: 1, active: true }]), replace)
    await sync.list(async () => ok([{ id: 2, active: true }]), replace)

    expect(applied).toEqual([[{ id: 1, active: true }], [{ id: 2, active: true }]])
  })

  it('las instancias son independientes entre entidades', async () => {
    const first = createMirrorSync()
    const second = createMirrorSync()
    const { applied, replace } = recorder()
    const slow = deferred<Result<Row[]>>()

    const pending = first.list(() => slow.promise, replace)
    second.reflectMutation(() => undefined)(null)
    slow.resolve(ok([]))
    await pending

    expect(applied).toHaveLength(1)
  })
})

describe('createMirrorSync.reflectMutation', () => {
  it('reenvía el dato al reflejo original', () => {
    const sync = createMirrorSync()
    const seen: number[] = []

    sync.reflectMutation((value: number) => void seen.push(value))(7)

    expect(seen).toEqual([7])
  })
})

describe('visibleRows', () => {
  const rows: readonly Row[] = [
    { id: 1, active: true },
    { id: 2, active: false },
  ]

  it('devuelve todo con includeInactive true', () => {
    expect(visibleRows(rows, { includeInactive: true })).toEqual(rows)
  })

  it('devuelve solo activos con includeInactive false', () => {
    expect(visibleRows(rows, { includeInactive: false })).toEqual([{ id: 1, active: true }])
  })

  it('no muta la colección de entrada', () => {
    const copy = [...rows]
    visibleRows(rows, { includeInactive: false })
    expect(rows).toEqual(copy)
  })
})
