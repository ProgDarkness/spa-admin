import { clearMocks, mockIPC } from '@tauri-apps/api/mocks'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { commands, type ResourceKind } from '@/lib/bindings'
import { settle } from '@/lib/ipc'
import { createSeed } from '@/lib/mock/seed'
import type { PermissionKey, SessionUser } from '@/lib/model'
import { createResourcesIpcBackend } from './resources-backend'

const SEED = createSeed('2026-11-12')
const SEED_RESOURCE_COUNT = 3
const SEED_ACTIVE_COUNT = 2
const INACTIVE_SEED_ID = 3
const FIRST_SEED_NAME = 'Cabina 1'
const MAX_NAME_CHARS = 80
const INSTANT_FORMAT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

const validInput: { name: string; kind: ResourceKind } = { name: 'Sala de masajes', kind: 'cabin' }

let nowMs: number
let session: SessionUser | null

function userWith(...permissions: PermissionKey[]): SessionUser {
  return { id: 50, username: 'tester', roleName: 'Prueba', permissions }
}

function failWhenUnrouted(command: string): never {
  throw new Error(`IPC no simulado: ${command}`)
}

beforeEach(() => {
  nowMs = Date.UTC(2026, 10, 12, 13, 0, 0)
  session = userWith('resources.manage')
  mockIPC(
    createResourcesIpcBackend(failWhenUnrouted, {
      session: () => session,
      resources: SEED.resources,
      now: () => nowMs,
    }),
  )
})

afterEach(() => clearMocks())

function validation(field: string) {
  return { status: 'error', error: { code: 'validation', field } }
}

describe('autorización', () => {
  it('rechaza todos los comandos sin sesión con unauthenticated', async () => {
    session = null

    const outcomes = [
      await commands.listResources({ includeInactive: true }),
      await commands.createResource(validInput),
      await commands.updateResource({ id: 1, ...validInput }),
      await commands.setResourceActive({ id: 1, active: false }),
    ]

    outcomes.forEach((outcome) => expect(outcome).toMatchObject({ status: 'error', error: { code: 'unauthenticated' } }))
  })

  it('permite listar con solo appointments.read o con solo resources.manage', async () => {
    session = userWith('appointments.read')
    expect(await commands.listResources({ includeInactive: true })).toMatchObject({ status: 'ok' })
    session = userWith('resources.manage')
    expect(await commands.listResources({ includeInactive: true })).toMatchObject({ status: 'ok' })
  })

  it('rechaza listar sin ninguno de los dos permisos con forbidden', async () => {
    session = userWith('catalog.read', 'catalog.write')

    expect(await commands.listResources({ includeInactive: true })).toMatchObject({
      status: 'error',
      error: { code: 'forbidden' },
    })
  })

  it('escribir exige resources.manage y no cambia nada con appointments.read', async () => {
    session = userWith('appointments.read')

    const outcomes = [
      await commands.createResource(validInput),
      await commands.updateResource({ id: 1, ...validInput }),
      await commands.setResourceActive({ id: 1, active: false }),
    ]

    outcomes.forEach((outcome) => expect(outcome).toMatchObject({ status: 'error', error: { code: 'forbidden' } }))
    session = userWith('resources.manage')
    const listed = await commands.listResources({ includeInactive: true })
    expect(listed.status === 'ok' && listed.data).toHaveLength(SEED_RESOURCE_COUNT)
    expect(listed.status === 'ok' && listed.data.find((resource) => resource.id === 1)?.active).toBe(true)
  })

  it('autoriza antes de validar', async () => {
    session = userWith('appointments.read')

    expect(await commands.createResource({ ...validInput, name: '' })).toMatchObject({
      status: 'error',
      error: { code: 'forbidden' },
    })
  })
})

describe('listResources', () => {
  it('incluye inactivos solo con includeInactive', async () => {
    const all = await commands.listResources({ includeInactive: true })
    const active = await commands.listResources({ includeInactive: false })

    expect(all.status === 'ok' && all.data).toHaveLength(SEED_RESOURCE_COUNT)
    expect(active.status === 'ok' && active.data).toHaveLength(SEED_ACTIVE_COUNT)
    expect(active.status === 'ok' && active.data.some((resource) => resource.id === INACTIVE_SEED_ID)).toBe(false)
  })

  it('entrega los recursos del seed con su tipo y marcas de tiempo ISO', async () => {
    const all = await commands.listResources({ includeInactive: true })

    expect(all.status === 'ok' && all.data.map(({ id, name, kind, active }) => ({ id, name, kind, active }))).toEqual([
      { id: 1, name: 'Cabina 1', kind: 'cabin', active: true },
      { id: 2, name: 'Cabina 2', kind: 'cabin', active: true },
      { id: 3, name: 'Manicure (Rosa)', kind: 'manicure', active: false },
    ])
    if (all.status !== 'ok') return
    all.data.forEach((resource) => {
      expect(resource.createdAt).toMatch(INSTANT_FORMAT)
      expect(resource.updatedAt).toBe(resource.createdAt)
    })
  })
})

describe('createResource: nombre', () => {
  it('recorta, colapsa espacios ASCII y compone a NFC', async () => {
    const created = await commands.createResource({ ...validInput, name: '  Café   sala  ' })

    expect(created.status === 'ok' && created.data.name).toBe('Café sala')
  })

  it.each(['', '   '])('rechaza el nombre vacío %j con validation name', async (name) => {
    expect(await commands.createResource({ ...validInput, name })).toMatchObject(validation('name'))
  })

  it('acepta 80 caracteres y rechaza 81, contando code points', async () => {
    const atLimit = await commands.createResource({ ...validInput, name: '😀'.repeat(MAX_NAME_CHARS) })
    const overLimit = await commands.createResource({ ...validInput, name: '😀'.repeat(MAX_NAME_CHARS + 1) })

    expect(atLimit.status).toBe('ok')
    expect(overLimit).toMatchObject(validation('name'))
  })

  it.each([
    ['tabulador', 'con\ttab'],
    ['ancho cero', 'con\u200Bcero'],
    ['nbsp', 'con\u00A0nbsp'],
    ['salto de línea', 'salto\nlinea'],
    ['formato bidi U+202E', 'Sa\u202Ela'],
    ['formato U+FEFF en el borde', '\uFEFFSala'],
    ['separador U+2028', 'Sa\u2028la'],
  ])('rechaza caracteres de control, formato o separadores: %s', async (_label, name) => {
    expect(await commands.createResource({ ...validInput, name })).toMatchObject(validation('name'))
  })

  it('recorta un U+0085 en el borde como Rust', async () => {
    const created = await commands.createResource({ ...validInput, name: '\u0085Sala\u0085' })

    expect(created.status === 'ok' && created.data.name).toBe('Sala')
  })
})

describe('createResource: tipo', () => {
  it.each(['cabin', 'manicure'] as const)('acepta el tipo %s', async (kind) => {
    const created = await commands.createResource({ ...validInput, kind })

    expect(created.status === 'ok' && created.data.kind).toBe(kind)
  })

  it.each(['sauna', '', 'CABIN', null, 7])('el tipo %j que Rust rechazaría al deserializar con serde (el cliente vería internal vía settle) se simula aquí como validation kind', async (kind) => {
    expect(await commands.createResource({ ...validInput, kind: kind as never })).toMatchObject(validation('kind'))
  })

  it('reporta primero el nombre y luego el tipo', async () => {
    expect(await commands.createResource({ name: '', kind: 'sauna' as never })).toMatchObject(validation('name'))
  })
})

describe('createResource: resultado y unicidad', () => {
  it('crea activo, con id siguiente y marcas de tiempo ISO', async () => {
    const created = await commands.createResource({ name: '  Sala de masajes  ', kind: 'cabin' })

    expect(created).toMatchObject({
      status: 'ok',
      data: { id: SEED_RESOURCE_COUNT + 1, name: 'Sala de masajes', kind: 'cabin', active: true },
    })
    if (created.status !== 'ok') return
    expect(created.data.createdAt).toMatch(INSTANT_FORMAT)
    expect(created.data.updatedAt).toBe(created.data.createdAt)
    const listed = await commands.listResources({ includeInactive: true })
    expect(listed.status === 'ok' && listed.data).toHaveLength(SEED_RESOURCE_COUNT + 1)
  })

  it('rechaza un nombre repetido sin distinguir mayúsculas ni espacios internos', async () => {
    expect(await commands.createResource({ ...validInput, name: FIRST_SEED_NAME.toUpperCase() })).toMatchObject(
      validation('name'),
    )
    expect(await commands.createResource({ ...validInput, name: 'cabina   1' })).toMatchObject(validation('name'))
  })

  it('rechaza un nombre que solo difiere por compatibilidad NFKC', async () => {
    expect(await commands.createResource({ ...validInput, name: '\uFF23abina 1' })).toMatchObject(validation('name'))
  })

  it('la unicidad también alcanza a los recursos inactivos', async () => {
    const inactive = SEED.resources.find((resource) => resource.id === INACTIVE_SEED_ID)

    expect(await commands.createResource({ ...validInput, name: inactive?.name ?? '' })).toMatchObject(validation('name'))
  })

  it('un rechazo no deja rastro en el listado', async () => {
    await commands.createResource({ ...validInput, name: '' })
    await commands.createResource({ ...validInput, name: FIRST_SEED_NAME })

    const listed = await commands.listResources({ includeInactive: true })
    expect(listed.status === 'ok' && listed.data).toHaveLength(SEED_RESOURCE_COUNT)
  })
})

describe('updateResource', () => {
  it('un id inexistente es validation id y gana a los datos inválidos', async () => {
    expect(await commands.updateResource({ id: 999, ...validInput })).toMatchObject(validation('id'))
    expect(await commands.updateResource({ id: 999, name: '', kind: 'sauna' as never })).toMatchObject(validation('id'))
  })

  it('valida los datos de un recurso existente', async () => {
    expect(await commands.updateResource({ id: 1, ...validInput, name: '' })).toMatchObject(validation('name'))
    expect(await commands.updateResource({ id: 1, ...validInput, kind: 'sauna' as never })).toMatchObject(
      validation('kind'),
    )
  })

  it('rechaza el nombre de otro recurso pero admite conservar el propio y cambiar su capitalización', async () => {
    expect(await commands.updateResource({ id: 2, ...validInput, name: FIRST_SEED_NAME })).toMatchObject(validation('name'))
    expect(await commands.updateResource({ id: 1, ...validInput, name: FIRST_SEED_NAME })).toMatchObject({ status: 'ok' })
    expect(await commands.updateResource({ id: 1, ...validInput, name: FIRST_SEED_NAME.toUpperCase() })).toMatchObject({
      status: 'ok',
    })
  })

  it('actualiza solo el objetivo, conserva activo y createdAt, y avanza updatedAt', async () => {
    const before = await commands.listResources({ includeInactive: true })
    nowMs += 60_000

    const updated = await commands.updateResource({ id: INACTIVE_SEED_ID, name: 'Manicure 2', kind: 'cabin' })

    expect(updated).toMatchObject({
      status: 'ok',
      data: { id: INACTIVE_SEED_ID, name: 'Manicure 2', kind: 'cabin', active: false },
    })
    if (updated.status !== 'ok' || before.status !== 'ok') return
    const original = before.data.find((resource) => resource.id === INACTIVE_SEED_ID)
    expect(updated.data.createdAt).toBe(original?.createdAt)
    expect(updated.data.updatedAt).not.toBe(original?.updatedAt)
    const after = await commands.listResources({ includeInactive: true })
    expect(after.status === 'ok' && after.data.find((resource) => resource.id === 1)).toEqual(
      before.data.find((resource) => resource.id === 1),
    )
  })

  it('un cambio que no modifica nada devuelve el registro intacto', async () => {
    const before = await commands.listResources({ includeInactive: true })
    nowMs += 60_000
    const current = before.status === 'ok' ? before.data[0] : undefined

    const unchanged = await commands.updateResource({ id: 1, name: current?.name ?? '', kind: current?.kind ?? 'cabin' })

    expect(unchanged).toEqual({ status: 'ok', data: current })
  })

  it('un cambio solo de tipo sí avanza updatedAt', async () => {
    const before = await commands.listResources({ includeInactive: true })
    nowMs += 60_000

    const changed = await commands.updateResource({ id: 1, name: FIRST_SEED_NAME, kind: 'manicure' })

    expect(before.status === 'ok' && changed.status === 'ok' && changed.data.kind).toBe('manicure')
    expect(
      before.status === 'ok' && changed.status === 'ok' && changed.data.updatedAt > (before.data[0]?.updatedAt ?? ''),
    ).toBe(true)
  })
})

describe('setResourceActive', () => {
  it('un id inexistente es validation id', async () => {
    expect(await commands.setResourceActive({ id: 999, active: false })).toMatchObject(validation('id'))
  })

  it('desactiva sin borrar y reactiva', async () => {
    const off = await commands.setResourceActive({ id: 1, active: false })
    const activeOnly = await commands.listResources({ includeInactive: false })
    const on = await commands.setResourceActive({ id: INACTIVE_SEED_ID, active: true })

    expect(off).toMatchObject({ status: 'ok', data: { id: 1, active: false } })
    expect(activeOnly.status === 'ok' && activeOnly.data.some((resource) => resource.id === 1)).toBe(false)
    expect(on).toMatchObject({ status: 'ok', data: { id: INACTIVE_SEED_ID, active: true } })
  })

  it('es idempotente y no avanza updatedAt', async () => {
    const before = await commands.setResourceActive({ id: 1, active: true })
    nowMs += 60_000

    const again = await commands.setResourceActive({ id: 1, active: true })

    expect(again).toEqual(before)
  })

  it('un cambio real avanza updatedAt', async () => {
    const before = await commands.setResourceActive({ id: 1, active: true })
    nowMs += 60_000

    const after = await commands.setResourceActive({ id: 1, active: false })

    expect(before.status === 'ok' && after.status === 'ok' && after.data.updatedAt > before.data.updatedAt).toBe(true)
  })

  it.each([['sí'], [1], [null], [undefined]])('rechaza active %j como fallo del canal', async (active) => {
    const outcome = await settle(() => commands.setResourceActive({ id: 1, active } as never))

    expect(outcome).toMatchObject({ status: 'error', error: { code: 'internal' } })
    const listed = await commands.listResources({ includeInactive: true })
    expect(listed.status === 'ok' && listed.data.find((resource) => resource.id === 1)?.active).toBe(true)
  })
})

describe('enrutamiento', () => {
  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])(
    'trata %s como comando desconocido y lo delega sin tocar el prototipo',
    (command) => {
      const backend = createResourcesIpcBackend(failWhenUnrouted, { session: () => session, resources: SEED.resources })

      expect(() => backend(command, {})).toThrow(`IPC no simulado: ${command}`)
    },
  )

  it('delega en el siguiente backend los comandos que no son de recursos', async () => {
    clearMocks()
    mockIPC(
      createResourcesIpcBackend((command) => (command === 'setup_status' ? { needsOwner: false, clockRollback: null } : null), {
        session: () => session,
        resources: SEED.resources,
      }),
    )

    expect(await commands.setupStatus()).toEqual({ status: 'ok', data: { needsOwner: false, clockRollback: null } })
  })

  it('el estado es propio de cada instancia', async () => {
    const other = createResourcesIpcBackend(failWhenUnrouted, { session: () => session, resources: SEED.resources })
    await commands.createResource(validInput)

    expect(other('list_resources', { filter: { includeInactive: true } })).toHaveLength(SEED_RESOURCE_COUNT)
  })
})
