import { clearMocks, mockIPC } from '@tauri-apps/api/mocks'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { commands } from '@/lib/bindings'
import { settle } from '@/lib/ipc'
import { createSeed } from '@/lib/mock/seed'
import { MAX_AMOUNT_CENTS } from '@/lib/money'
import type { PermissionKey, SessionUser } from '@/lib/model'
import { createCatalogIpcBackend } from './catalog-backend'

const SEED = createSeed('2026-11-12')
const SEED_SERVICE_COUNT = 8
const SEED_ACTIVE_COUNT = 7
const INACTIVE_SEED_ID = 8
const FIRST_SEED_NAME = 'Limpieza facial (ejemplo)'
const MAX_NAME_CHARS = 80
const MAX_DURATION_MIN = 1440
const INSTANT_FORMAT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

const validInput = { name: 'Depilación', priceCents: 2_500, durationMin: 30 }

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
  session = userWith('catalog.read', 'catalog.write')
  mockIPC(
    createCatalogIpcBackend(failWhenUnrouted, {
      session: () => session,
      services: SEED.services,
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
      await commands.listServices({ includeInactive: true }),
      await commands.createService(validInput),
      await commands.updateService({ id: 1, ...validInput }),
      await commands.setServiceActive({ id: 1, active: false }),
    ]

    outcomes.forEach((outcome) => expect(outcome).toMatchObject({ status: 'error', error: { code: 'unauthenticated' } }))
  })

  it('permite listar con solo catalog.read o con solo catalog.write', async () => {
    session = userWith('catalog.read')
    expect(await commands.listServices({ includeInactive: true })).toMatchObject({ status: 'ok' })
    session = userWith('catalog.write')
    expect(await commands.listServices({ includeInactive: true })).toMatchObject({ status: 'ok' })
  })

  it('rechaza listar sin ninguno de los dos permisos con forbidden', async () => {
    session = userWith('clients.read')

    expect(await commands.listServices({ includeInactive: true })).toMatchObject({
      status: 'error',
      error: { code: 'forbidden' },
    })
  })

  it('escribir exige catalog.write y no cambia nada con catalog.read', async () => {
    session = userWith('catalog.read')

    const outcomes = [
      await commands.createService(validInput),
      await commands.updateService({ id: 1, ...validInput }),
      await commands.setServiceActive({ id: 1, active: false }),
    ]

    outcomes.forEach((outcome) => expect(outcome).toMatchObject({ status: 'error', error: { code: 'forbidden' } }))
    session = userWith('catalog.read', 'catalog.write')
    const listed = await commands.listServices({ includeInactive: true })
    expect(listed.status === 'ok' && listed.data).toHaveLength(SEED_SERVICE_COUNT)
  })

  it('autoriza antes de validar', async () => {
    session = userWith('catalog.read')

    expect(await commands.createService({ ...validInput, priceCents: 0 })).toMatchObject({
      status: 'error',
      error: { code: 'forbidden' },
    })
  })
})

describe('listServices', () => {
  it('incluye inactivos solo con includeInactive', async () => {
    const all = await commands.listServices({ includeInactive: true })
    const active = await commands.listServices({ includeInactive: false })

    expect(all.status === 'ok' && all.data).toHaveLength(SEED_SERVICE_COUNT)
    expect(active.status === 'ok' && active.data).toHaveLength(SEED_ACTIVE_COUNT)
    expect(active.status === 'ok' && active.data.some((service) => service.id === INACTIVE_SEED_ID)).toBe(false)
  })

  it('entrega los servicios del seed con moneda USD', async () => {
    const all = await commands.listServices({ includeInactive: true })

    expect(all.status === 'ok' && all.data[0]).toMatchObject({
      id: 1,
      name: FIRST_SEED_NAME,
      priceCents: 3_500,
      currency: 'USD',
      durationMin: 60,
      active: true,
    })
  })
})

describe('createService: normalización del nombre', () => {
  it('recorta, colapsa espacios ASCII y compone a NFC', async () => {
    const created = await commands.createService({ ...validInput, name: '  Café   con   leche  ' })

    expect(created.status === 'ok' && created.data.name).toBe('Café con leche')
  })

  it.each(['', '   '])('rechaza el nombre vacío %j con validation name', async (name) => {
    expect(await commands.createService({ ...validInput, name })).toMatchObject(validation('name'))
  })

  it('acepta 80 caracteres y rechaza 81, contando code points', async () => {
    const atLimit = await commands.createService({ ...validInput, name: '😀'.repeat(MAX_NAME_CHARS) })
    const overLimit = await commands.createService({ ...validInput, name: '😀'.repeat(MAX_NAME_CHARS + 1) })

    expect(atLimit.status).toBe('ok')
    expect(overLimit).toMatchObject(validation('name'))
  })

  it.each(['con\ttab', 'con​cero', 'con nbsp', 'salto\nlinea'])(
    'rechaza caracteres de control, formato o separadores: %j',
    async (name) => {
      expect(await commands.createService({ ...validInput, name })).toMatchObject(validation('name'))
    },
  )
})

const RANGE_SAMPLES: readonly (readonly [string, string])[] = [
  ['control Cc U+0085', '\u0085'],
  ['formato U+00AD', '­'],
  ['formato U+0600', '؀'],
  ['formato U+0605', '؅'],
  ['formato U+061C', '؜'],
  ['formato U+06DD', '۝'],
  ['formato U+070F', '܏'],
  ['formato U+0890', '࢐'],
  ['formato U+0891', '࢑'],
  ['formato U+08E2', '࣢'],
  ['formato U+180E', '᠎'],
  ['formato U+200B', '​'],
  ['formato U+200F', '‏'],
  ['formato U+202A', '‪'],
  ['formato U+202E', '‮'],
  ['formato U+2060', '⁠'],
  ['formato U+2064', '⁤'],
  ['formato U+2066', '⁦'],
  ['formato U+206F', '⁯'],
  ['formato U+FEFF', '﻿'],
  ['formato U+FFF9', '￹'],
  ['formato U+FFFB', '￻'],
  ['formato U+110BD', '\u{110BD}'],
  ['formato U+110CD', '\u{110CD}'],
  ['formato U+13430', '\u{13430}'],
  ['formato U+1343F', '\u{1343F}'],
  ['formato U+1BCA0', '\u{1BCA0}'],
  ['formato U+1BCA3', '\u{1BCA3}'],
  ['formato U+1D173', '\u{1D173}'],
  ['formato U+1D17A', '\u{1D17A}'],
  ['formato U+E0001', '\u{E0001}'],
  ['formato U+E0020', '\u{E0020}'],
  ['formato U+E007F', '\u{E007F}'],
  ['separador U+00A0', ' '],
  ['separador U+1680', ' '],
  ['separador U+2000', ' '],
  ['separador U+200A', ' '],
  ['separador U+2028', ' '],
  ['separador U+2029', ' '],
  ['separador U+202F', ' '],
  ['separador U+205F', ' '],
  ['separador U+3000', '　'],
]

describe('createService: un carácter por cada rango no permitido de Rust', () => {
  it.each(RANGE_SAMPLES)('rechaza %s en medio del nombre', async (_label, character) => {
    expect(await commands.createService({ ...validInput, name: `Sa${character}la` })).toMatchObject(validation('name'))
  })

  it('colapsa exactamente dos espacios ASCII', async () => {
    const created = await commands.createService({ ...validInput, name: 'a  b' })

    expect(created.status === 'ok' && created.data.name).toBe('a b')
  })
})

describe('createService: recorte con White_Space de Unicode', () => {
  it('rechaza un U+FEFF en el borde porque no es White_Space y es de formato', async () => {
    expect(await commands.createService({ ...validInput, name: '﻿Sala' })).toMatchObject(validation('name'))
  })

  it('recorta un U+0085 en el borde como Rust', async () => {
    const created = await commands.createService({ ...validInput, name: '\u0085Sala\u0085' })

    expect(created.status === 'ok' && created.data.name).toBe('Sala')
  })
})

describe('despacho de comandos', () => {
  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])(
    'trata %s como comando desconocido y lo delega sin tocar el prototipo',
    (command) => {
      const backend = createCatalogIpcBackend(failWhenUnrouted, { session: () => session, services: SEED.services })

      expect(() => backend(command, {})).toThrow(`IPC no simulado: ${command}`)
    },
  )
})

describe('argumentos que Rust no deserializaría', () => {
  it.each([['sí'], [1], [null], [undefined]])('set_service_active rechaza active %j como fallo del canal', async (active) => {
    const outcome = await settle(() => commands.setServiceActive({ id: 1, active } as never))

    expect(outcome).toMatchObject({ status: 'error', error: { code: 'internal' } })
    const listed = await commands.listServices({ includeInactive: true })
    expect(listed.status === 'ok' && listed.data.find((service) => service.id === 1)?.active).toBe(true)
  })
})

describe('createService: precio y duración', () => {
  it.each([0, -1, MAX_AMOUNT_CENTS + 1, 1.5])('rechaza el precio %s con validation priceCents', async (priceCents) => {
    expect(await commands.createService({ ...validInput, priceCents })).toMatchObject(validation('priceCents'))
  })

  it.each([1, MAX_AMOUNT_CENTS])('acepta el precio límite %s', async (priceCents) => {
    expect(await commands.createService({ ...validInput, priceCents })).toMatchObject({ status: 'ok' })
  })

  it.each([0, -5, 12, MAX_DURATION_MIN + 5, 30.5])('rechaza la duración %s con validation durationMin', async (durationMin) => {
    expect(await commands.createService({ ...validInput, durationMin })).toMatchObject(validation('durationMin'))
  })

  it.each([5, 1_435, MAX_DURATION_MIN])('acepta la duración %s', async (durationMin) => {
    expect(await commands.createService({ ...validInput, durationMin })).toMatchObject({ status: 'ok' })
  })

  it('reporta primero el nombre, luego el precio y luego la duración', async () => {
    expect(await commands.createService({ name: '', priceCents: 0, durationMin: 12 })).toMatchObject(validation('name'))
    expect(await commands.createService({ ...validInput, priceCents: 0, durationMin: 12 })).toMatchObject(
      validation('priceCents'),
    )
  })
})

describe('createService: resultado y unicidad', () => {
  it('crea activo, en USD, con id siguiente y marcas de tiempo ISO', async () => {
    const created = await commands.createService({ ...validInput, name: '  Depilación  ' })

    expect(created).toMatchObject({
      status: 'ok',
      data: { id: SEED_SERVICE_COUNT + 1, name: 'Depilación', priceCents: 2_500, currency: 'USD', durationMin: 30, active: true },
    })
    if (created.status !== 'ok') return
    expect(created.data.createdAt).toMatch(INSTANT_FORMAT)
    expect(created.data.updatedAt).toBe(created.data.createdAt)
    const listed = await commands.listServices({ includeInactive: true })
    expect(listed.status === 'ok' && listed.data).toHaveLength(SEED_SERVICE_COUNT + 1)
  })

  it('rechaza un nombre repetido sin distinguir mayúsculas ni espacios internos', async () => {
    expect(await commands.createService({ ...validInput, name: FIRST_SEED_NAME.toUpperCase() })).toMatchObject(
      validation('name'),
    )
    expect(await commands.createService({ ...validInput, name: 'Limpieza   facial (ejemplo)' })).toMatchObject(
      validation('name'),
    )
  })

  it('rechaza un nombre que solo difiere por compatibilidad NFKC', async () => {
    expect(await commands.createService({ ...validInput, name: 'Ｌimpieza facial (ejemplo)' })).toMatchObject(
      validation('name'),
    )
  })

  it('la unicidad también alcanza a los servicios inactivos', async () => {
    const inactive = SEED.services.find((service) => service.id === INACTIVE_SEED_ID)

    expect(await commands.createService({ ...validInput, name: inactive?.name ?? '' })).toMatchObject(validation('name'))
  })

  it('un rechazo no deja rastro en el listado', async () => {
    await commands.createService({ ...validInput, priceCents: 0 })
    await commands.createService({ ...validInput, name: FIRST_SEED_NAME })

    const listed = await commands.listServices({ includeInactive: true })
    expect(listed.status === 'ok' && listed.data).toHaveLength(SEED_SERVICE_COUNT)
  })
})

describe('updateService', () => {
  it('un id inexistente es validation id y gana a los datos inválidos', async () => {
    expect(await commands.updateService({ id: 999, ...validInput })).toMatchObject(validation('id'))
    expect(await commands.updateService({ id: 999, name: '', priceCents: 0, durationMin: 1 })).toMatchObject(
      validation('id'),
    )
  })

  it('valida los datos de un servicio existente', async () => {
    expect(await commands.updateService({ id: 1, ...validInput, name: '' })).toMatchObject(validation('name'))
    expect(await commands.updateService({ id: 1, ...validInput, priceCents: 0 })).toMatchObject(validation('priceCents'))
    expect(await commands.updateService({ id: 1, ...validInput, durationMin: 7 })).toMatchObject(
      validation('durationMin'),
    )
  })

  it('rechaza el nombre de otro servicio pero admite conservar el propio y cambiar su capitalización', async () => {
    expect(await commands.updateService({ id: 2, ...validInput, name: FIRST_SEED_NAME })).toMatchObject(validation('name'))
    expect(await commands.updateService({ id: 1, ...validInput, name: FIRST_SEED_NAME })).toMatchObject({ status: 'ok' })
    expect(await commands.updateService({ id: 1, ...validInput, name: FIRST_SEED_NAME.toUpperCase() })).toMatchObject({
      status: 'ok',
    })
  })

  it('actualiza solo el objetivo, conserva activo y createdAt, y avanza updatedAt', async () => {
    const before = await commands.listServices({ includeInactive: true })
    nowMs += 60_000

    const updated = await commands.updateService({ id: INACTIVE_SEED_ID, ...validInput })

    expect(updated).toMatchObject({ status: 'ok', data: { id: INACTIVE_SEED_ID, ...validInput, active: false } })
    if (updated.status !== 'ok' || before.status !== 'ok') return
    const original = before.data.find((service) => service.id === INACTIVE_SEED_ID)
    expect(updated.data.createdAt).toBe(original?.createdAt)
    expect(updated.data.updatedAt).not.toBe(original?.updatedAt)
    const after = await commands.listServices({ includeInactive: true })
    expect(after.status === 'ok' && after.data.find((service) => service.id === 1)).toEqual(
      before.data.find((service) => service.id === 1),
    )
  })

  it('un cambio que no modifica nada devuelve el registro intacto', async () => {
    const before = await commands.listServices({ includeInactive: true })
    nowMs += 60_000
    const current = before.status === 'ok' ? before.data[0] : undefined

    const unchanged = await commands.updateService({
      id: 1,
      name: current?.name ?? '',
      priceCents: current?.priceCents ?? 0,
      durationMin: current?.durationMin ?? 0,
    })

    expect(unchanged).toEqual({ status: 'ok', data: current })
  })
})

describe('setServiceActive', () => {
  it('un id inexistente es validation id', async () => {
    expect(await commands.setServiceActive({ id: 999, active: false })).toMatchObject(validation('id'))
  })

  it('desactiva sin borrar y reactiva', async () => {
    const off = await commands.setServiceActive({ id: 1, active: false })
    const activeOnly = await commands.listServices({ includeInactive: false })
    const on = await commands.setServiceActive({ id: INACTIVE_SEED_ID, active: true })

    expect(off).toMatchObject({ status: 'ok', data: { id: 1, active: false } })
    expect(activeOnly.status === 'ok' && activeOnly.data.some((service) => service.id === 1)).toBe(false)
    expect(on).toMatchObject({ status: 'ok', data: { id: INACTIVE_SEED_ID, active: true } })
  })

  it('es idempotente y no avanza updatedAt', async () => {
    const before = await commands.setServiceActive({ id: 1, active: true })
    nowMs += 60_000

    const again = await commands.setServiceActive({ id: 1, active: true })

    expect(again).toEqual(before)
  })

  it('un cambio real avanza updatedAt', async () => {
    const before = await commands.setServiceActive({ id: 1, active: true })
    nowMs += 60_000

    const after = await commands.setServiceActive({ id: 1, active: false })

    expect(before.status === 'ok' && after.status === 'ok' && after.data.updatedAt > before.data.updatedAt).toBe(true)
  })
})

describe('enrutamiento', () => {
  it('delega en el siguiente backend los comandos que no son de catálogo', async () => {
    clearMocks()
    mockIPC(
      createCatalogIpcBackend((command) => (command === 'setup_status' ? { needsOwner: false, clockRollback: null } : null), {
        session: () => session,
        services: SEED.services,
      }),
    )

    expect(await commands.setupStatus()).toEqual({ status: 'ok', data: { needsOwner: false, clockRollback: null } })
  })

  it('el estado es propio de cada instancia', async () => {
    const other = createCatalogIpcBackend(failWhenUnrouted, { session: () => session, services: SEED.services })
    await commands.createService(validInput)

    expect(other('list_services', { filter: { includeInactive: true } })).toHaveLength(SEED_SERVICE_COUNT)
  })
})
