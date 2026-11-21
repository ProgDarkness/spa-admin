import { clearMocks, mockIPC } from '@tauri-apps/api/mocks'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { commands } from '@/lib/bindings'
import { settle } from '@/lib/ipc'
import { createSeed } from '@/lib/mock/seed'
import type { PermissionKey, SessionUser } from '@/lib/model'
import { createPaymentMethodsIpcBackend } from './payment-methods-backend'

const SEED = createSeed('2026-11-12')
const SEED_METHOD_COUNT = 5
const FIRST_SEED_NAME = 'Efectivo'
const MAX_NAME_CHARS = 80
const INSTANT_FORMAT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

const validInput = { name: 'Cripto' }

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
    createPaymentMethodsIpcBackend(failWhenUnrouted, {
      session: () => session,
      paymentMethods: SEED.paymentMethods,
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
      await commands.listPaymentMethods({ includeInactive: true }),
      await commands.createPaymentMethod(validInput),
      await commands.updatePaymentMethod({ id: 1, ...validInput }),
      await commands.setPaymentMethodActive({ id: 1, active: false }),
    ]

    outcomes.forEach((outcome) => expect(outcome).toMatchObject({ status: 'error', error: { code: 'unauthenticated' } }))
  })

  it('permite listar con solo catalog.read o con solo payments.read', async () => {
    session = userWith('catalog.read')
    expect(await commands.listPaymentMethods({ includeInactive: true })).toMatchObject({ status: 'ok' })
    session = userWith('payments.read')
    expect(await commands.listPaymentMethods({ includeInactive: true })).toMatchObject({ status: 'ok' })
  })

  it('rechaza listar sin ninguno de los dos permisos con forbidden', async () => {
    session = userWith('catalog.write', 'resources.manage')

    expect(await commands.listPaymentMethods({ includeInactive: true })).toMatchObject({
      status: 'error',
      error: { code: 'forbidden' },
    })
  })

  it.each([
    ['catalog.read'],
    ['payments.read'],
    ['payments.write'],
  ] as const)('escribir exige catalog.write y no cambia nada con solo %s', async (permission) => {
    session = userWith(permission, 'catalog.read', 'payments.read')

    const outcomes = [
      await commands.createPaymentMethod(validInput),
      await commands.updatePaymentMethod({ id: 1, ...validInput }),
      await commands.setPaymentMethodActive({ id: 1, active: false }),
    ]

    outcomes.forEach((outcome) => expect(outcome).toMatchObject({ status: 'error', error: { code: 'forbidden' } }))
    const listed = await commands.listPaymentMethods({ includeInactive: true })
    expect(listed.status === 'ok' && listed.data).toHaveLength(SEED_METHOD_COUNT)
    expect(listed.status === 'ok' && listed.data.find((method) => method.id === 1)?.active).toBe(true)
  })

  it('autoriza antes de validar', async () => {
    session = userWith('payments.write')

    expect(await commands.createPaymentMethod({ name: '' })).toMatchObject({
      status: 'error',
      error: { code: 'forbidden' },
    })
  })
})

describe('listPaymentMethods', () => {
  it('incluye inactivos solo con includeInactive', async () => {
    await commands.setPaymentMethodActive({ id: 3, active: false })

    const all = await commands.listPaymentMethods({ includeInactive: true })
    const active = await commands.listPaymentMethods({ includeInactive: false })

    expect(all.status === 'ok' && all.data).toHaveLength(SEED_METHOD_COUNT)
    expect(active.status === 'ok' && active.data).toHaveLength(SEED_METHOD_COUNT - 1)
    expect(active.status === 'ok' && active.data.some((method) => method.id === 3)).toBe(false)
  })

  it('entrega los métodos del seed con ids 1 a 5, activos y marcas de tiempo ISO', async () => {
    const all = await commands.listPaymentMethods({ includeInactive: true })

    expect(
      all.status === 'ok' && all.data.map(({ id, name, active }) => ({ id, name, active })).sort((a, b) => a.id - b.id),
    ).toEqual([
      { id: 1, name: 'Efectivo', active: true },
      { id: 2, name: 'Pago móvil', active: true },
      { id: 3, name: 'Zelle', active: true },
      { id: 4, name: 'Transferencia', active: true },
      { id: 5, name: 'Punto de venta', active: true },
    ])
    if (all.status !== 'ok') return
    all.data.forEach((method) => {
      expect(method.createdAt).toMatch(INSTANT_FORMAT)
      expect(method.updatedAt).toBe(method.createdAt)
    })
  })

  it('ordena por nombre sin distinguir mayúsculas ASCII', async () => {
    await commands.createPaymentMethod({ name: 'banesco' })
    await commands.createPaymentMethod({ name: 'Zelle 2' })

    const all = await commands.listPaymentMethods({ includeInactive: true })

    expect(all.status === 'ok' && all.data.map((method) => method.name)).toEqual([
      'banesco',
      'Efectivo',
      'Pago móvil',
      'Punto de venta',
      'Transferencia',
      'Zelle',
      'Zelle 2',
    ])
  })
})

describe('listPaymentMethods: orden como NOCASE de SQLite', () => {
  async function namesInListOrder(created: readonly string[]): Promise<string[]> {
    for (const name of created) await commands.createPaymentMethod({ name })
    const all = await commands.listPaymentMethods({ includeInactive: true })
    return all.status === 'ok' ? all.data.map((method) => method.name).filter((name) => created.includes(name)) : []
  }

  it('pliega solo ASCII: una vocal acentuada mayúscula queda detrás de una letra ASCII', async () => {
    expect(await namesInListOrder(['Éxito', 'ezzz'])).toEqual(['ezzz', 'Éxito'])
  })

  it('no pliega mayúsculas no ASCII: É (C3 89) queda antes que è (C3 A8)', async () => {
    expect(await namesInListOrder(['èxito', 'Éxito'])).toEqual(['Éxito', 'èxito'])
  })

  it('compara por bytes UTF-8: U+FF21 (EF BC A1) queda antes que un astral (F0 9F 98 80)', async () => {
    expect(await namesInListOrder(['😀', 'Ａ'])).toEqual(['Ａ', '😀'])
  })
})

describe('createPaymentMethod: nombre', () => {
  it('recorta, colapsa espacios ASCII y compone a NFC', async () => {
    const created = await commands.createPaymentMethod({ name: '  Café   pago  ' })

    expect(created.status === 'ok' && created.data.name).toBe('Café pago')
  })

  it.each(['', '   '])('rechaza el nombre vacío %j con validation name', async (name) => {
    expect(await commands.createPaymentMethod({ name })).toMatchObject(validation('name'))
  })

  it('acepta 80 caracteres y rechaza 81, contando code points', async () => {
    const atLimit = await commands.createPaymentMethod({ name: '😀'.repeat(MAX_NAME_CHARS) })
    const overLimit = await commands.createPaymentMethod({ name: '😀'.repeat(MAX_NAME_CHARS + 1) })

    expect(atLimit.status).toBe('ok')
    expect(overLimit).toMatchObject(validation('name'))
  })

  it.each([
    ['tabulador', 'con\ttab'],
    ['ancho cero', 'con​cero'],
    ['nbsp', 'con nbsp'],
    ['salto de línea', 'salto\nlinea'],
    ['formato bidi U+202E', 'Sa‮la'],
    ['formato U+FEFF en el borde', '﻿Sala'],
    ['separador U+2028', 'Sa la'],
  ])('rechaza caracteres de control, formato o separadores: %s', async (_label, name) => {
    expect(await commands.createPaymentMethod({ name })).toMatchObject(validation('name'))
  })

  it('recorta un U+0085 en el borde como Rust', async () => {
    const created = await commands.createPaymentMethod({ name: '\u0085Cripto\u0085' })

    expect(created.status === 'ok' && created.data.name).toBe('Cripto')
  })
})

describe('createPaymentMethod: resultado y unicidad', () => {
  it('crea activo, con id siguiente y marcas de tiempo ISO', async () => {
    const created = await commands.createPaymentMethod({ name: '  Cripto  ' })

    expect(created).toMatchObject({
      status: 'ok',
      data: { id: SEED_METHOD_COUNT + 1, name: 'Cripto', active: true },
    })
    if (created.status !== 'ok') return
    expect(created.data.createdAt).toMatch(INSTANT_FORMAT)
    expect(created.data.updatedAt).toBe(created.data.createdAt)
    const listed = await commands.listPaymentMethods({ includeInactive: true })
    expect(listed.status === 'ok' && listed.data).toHaveLength(SEED_METHOD_COUNT + 1)
  })

  it('rechaza un nombre repetido sin distinguir mayúsculas ni espacios internos', async () => {
    expect(await commands.createPaymentMethod({ name: FIRST_SEED_NAME.toUpperCase() })).toMatchObject(validation('name'))
    expect(await commands.createPaymentMethod({ name: 'pago   MÓVIL' })).toMatchObject(validation('name'))
  })

  it('rechaza un nombre que solo difiere por compatibilidad NFKC', async () => {
    expect(await commands.createPaymentMethod({ name: 'Ｅfectivo' })).toMatchObject(validation('name'))
  })

  it('la unicidad también alcanza a los métodos inactivos', async () => {
    await commands.setPaymentMethodActive({ id: 1, active: false })

    expect(await commands.createPaymentMethod({ name: FIRST_SEED_NAME })).toMatchObject(validation('name'))
  })

  it('un rechazo no deja rastro en el listado', async () => {
    await commands.createPaymentMethod({ name: '' })
    await commands.createPaymentMethod({ name: FIRST_SEED_NAME })

    const listed = await commands.listPaymentMethods({ includeInactive: true })
    expect(listed.status === 'ok' && listed.data).toHaveLength(SEED_METHOD_COUNT)
  })
})

describe('updatePaymentMethod', () => {
  it('un id inexistente es validation id y gana a los datos inválidos', async () => {
    expect(await commands.updatePaymentMethod({ id: 999, ...validInput })).toMatchObject(validation('id'))
    expect(await commands.updatePaymentMethod({ id: 999, name: '' })).toMatchObject(validation('id'))
  })

  it('valida el nombre de un método existente', async () => {
    expect(await commands.updatePaymentMethod({ id: 1, name: '' })).toMatchObject(validation('name'))
  })

  it('rechaza el nombre de otro método pero admite conservar el propio y cambiar su capitalización', async () => {
    expect(await commands.updatePaymentMethod({ id: 2, name: FIRST_SEED_NAME })).toMatchObject(validation('name'))
    expect(await commands.updatePaymentMethod({ id: 1, name: FIRST_SEED_NAME })).toMatchObject({ status: 'ok' })
    expect(await commands.updatePaymentMethod({ id: 1, name: FIRST_SEED_NAME.toUpperCase() })).toMatchObject({
      status: 'ok',
    })
  })

  it('actualiza solo el objetivo, conserva activo y createdAt, y avanza updatedAt', async () => {
    await commands.setPaymentMethodActive({ id: 3, active: false })
    const before = await commands.listPaymentMethods({ includeInactive: true })
    nowMs += 60_000

    const updated = await commands.updatePaymentMethod({ id: 3, name: 'Zelle USD' })

    expect(updated).toMatchObject({ status: 'ok', data: { id: 3, name: 'Zelle USD', active: false } })
    if (updated.status !== 'ok' || before.status !== 'ok') return
    const original = before.data.find((method) => method.id === 3)
    expect(updated.data.createdAt).toBe(original?.createdAt)
    expect(updated.data.updatedAt).not.toBe(original?.updatedAt)
    const after = await commands.listPaymentMethods({ includeInactive: true })
    expect(after.status === 'ok' && after.data.find((method) => method.id === 1)).toEqual(
      before.data.find((method) => method.id === 1),
    )
  })

  it('un cambio que no modifica nada devuelve el registro intacto sin avanzar updatedAt', async () => {
    const before = await commands.listPaymentMethods({ includeInactive: true })
    nowMs += 60_000
    const current = before.status === 'ok' ? before.data.find((method) => method.id === 1) : undefined

    const unchanged = await commands.updatePaymentMethod({ id: 1, name: current?.name ?? '' })

    expect(unchanged).toEqual({ status: 'ok', data: current })
  })
})

describe('setPaymentMethodActive', () => {
  it('un id inexistente es validation id', async () => {
    expect(await commands.setPaymentMethodActive({ id: 999, active: false })).toMatchObject(validation('id'))
  })

  it('desactiva sin borrar y reactiva', async () => {
    const off = await commands.setPaymentMethodActive({ id: 1, active: false })
    const activeOnly = await commands.listPaymentMethods({ includeInactive: false })
    const on = await commands.setPaymentMethodActive({ id: 1, active: true })

    expect(off).toMatchObject({ status: 'ok', data: { id: 1, active: false } })
    expect(activeOnly.status === 'ok' && activeOnly.data.some((method) => method.id === 1)).toBe(false)
    expect(on).toMatchObject({ status: 'ok', data: { id: 1, active: true } })
  })

  it('es idempotente y no avanza updatedAt', async () => {
    const before = await commands.setPaymentMethodActive({ id: 1, active: true })
    nowMs += 60_000

    const again = await commands.setPaymentMethodActive({ id: 1, active: true })

    expect(again).toEqual(before)
  })

  it('un cambio real avanza updatedAt', async () => {
    const before = await commands.setPaymentMethodActive({ id: 1, active: true })
    nowMs += 60_000

    const after = await commands.setPaymentMethodActive({ id: 1, active: false })

    expect(before.status === 'ok' && after.status === 'ok' && after.data.updatedAt > before.data.updatedAt).toBe(true)
  })

  it.each([['sí'], [1], [null], [undefined]])('rechaza active %j como fallo del canal', async (active) => {
    const outcome = await settle(() => commands.setPaymentMethodActive({ id: 1, active } as never))

    expect(outcome).toMatchObject({ status: 'error', error: { code: 'internal' } })
    const listed = await commands.listPaymentMethods({ includeInactive: true })
    expect(listed.status === 'ok' && listed.data.find((method) => method.id === 1)?.active).toBe(true)
  })
})

describe('enrutamiento', () => {
  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])(
    'trata %s como comando desconocido y lo delega sin tocar el prototipo',
    (command) => {
      const backend = createPaymentMethodsIpcBackend(failWhenUnrouted, {
        session: () => session,
        paymentMethods: SEED.paymentMethods,
      })

      expect(() => backend(command, {})).toThrow(`IPC no simulado: ${command}`)
    },
  )

  it('delega en el siguiente backend los comandos que no son de métodos de pago', async () => {
    clearMocks()
    mockIPC(
      createPaymentMethodsIpcBackend(
        (command) => (command === 'setup_status' ? { needsOwner: false, clockRollback: null } : null),
        { session: () => session, paymentMethods: SEED.paymentMethods },
      ),
    )

    expect(await commands.setupStatus()).toEqual({ status: 'ok', data: { needsOwner: false, clockRollback: null } })
  })

  it('el estado es propio de cada instancia', async () => {
    const other = createPaymentMethodsIpcBackend(failWhenUnrouted, {
      session: () => session,
      paymentMethods: SEED.paymentMethods,
    })
    await commands.createPaymentMethod(validInput)

    expect(other('list_payment_methods', { filter: { includeInactive: true } })).toHaveLength(SEED_METHOD_COUNT)
  })
})
