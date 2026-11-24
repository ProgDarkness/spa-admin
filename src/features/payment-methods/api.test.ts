import { clearMocks, mockIPC } from '@tauri-apps/api/mocks'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { currentUser } from '@/lib/mock/authorize'
import { commit, getState, resetStore } from '@/lib/mock/store'
import type { AppError, PaymentMethod } from '@/lib/model'
import { freezeDate } from '@/test/clock'
import { createPaymentMethodsIpcBackend } from '@/test/ipc/payment-methods-backend'
import { signInAs } from '@/test/session'
import { createPaymentMethod, listPaymentMethods, setPaymentMethodActive, updatePaymentMethod } from './api'

const MANAGER = 'propietaria'
const READER = 'lectura'
const MISSING_ID = 999
const SEED_METHOD_COUNT = 5
const METHOD_KEYS = ['active', 'id', 'name']
const ALL = { includeInactive: true }

let calls: { cmd: string; args: unknown }[]
let thrownByIpc: unknown

function installPaymentMethodsIpc(): void {
  const backend = createPaymentMethodsIpcBackend(
    (cmd) => {
      throw new Error(`IPC no simulado: ${cmd}`)
    },
    { session: () => currentUser(getState()), paymentMethods: getState().paymentMethods },
  )
  mockIPC((cmd, args) => {
    calls.push({ cmd, args })
    if (thrownByIpc !== undefined) throw thrownByIpc
    return backend(cmd, args)
  })
}

function appError(code: AppError['code'], field: string | null = null): AppError {
  return { code, message: 'mensaje del backend', field, entityIds: null }
}

function methodOf(result: Awaited<ReturnType<typeof createPaymentMethod>>): PaymentMethod {
  if (result.status !== 'ok') throw new Error('se esperaba ok')
  return result.data
}

beforeEach(() => {
  freezeDate('2026-11-12T09:00')
  resetStore()
  calls = []
  thrownByIpc = undefined
  installPaymentMethodsIpc()
})

afterEach(() => clearMocks())

describe('listPaymentMethods', () => {
  it('rechaza sin sesión con unauthenticated y no devuelve los datos del mock', async () => {
    expect(await listPaymentMethods(ALL)).toMatchObject({ status: 'error', error: { code: 'unauthenticated' } })
  })

  it.each(['propietaria', 'recepcion', READER] as const)('lista los métodos a %s', async (username) => {
    signInAs(username)

    const result = await listPaymentMethods(ALL)

    expect(result.status === 'ok' && result.data.map((method) => method.id).sort()).toEqual([1, 2, 3, 4, 5])
  })

  it('rechaza sin catalog.read ni payments.read con forbidden', async () => {
    signInAs(READER)
    commit({
      ...getState(),
      users: getState().users.map((user) => (user.username === READER ? { ...user, permissions: ['clients.read'] } : user)),
    })

    expect(await listPaymentMethods(ALL)).toMatchObject({ status: 'error', error: { code: 'forbidden' } })
  })

  it('pide siempre la colección completa a list_payment_methods sea cual sea el filtro del llamador', async () => {
    signInAs(MANAGER)

    await listPaymentMethods({ includeInactive: false })
    await listPaymentMethods(ALL)

    expect(calls).toEqual([
      { cmd: 'list_payment_methods', args: { filter: { includeInactive: true } } },
      { cmd: 'list_payment_methods', args: { filter: ALL } },
    ])
  })

  it('devuelve solo los campos de PaymentMethod, sin las marcas de tiempo de Rust', async () => {
    signInAs(MANAGER)

    const result = await listPaymentMethods(ALL)

    expect(result.status === 'ok' && result.data.map((method) => Object.keys(method).sort())).toEqual(
      Array.from({ length: SEED_METHOD_COUNT }, () => METHOD_KEYS),
    )
  })

  it('con includeInactive false refleja la colección completa en el store y devuelve solo los activos', async () => {
    signInAs(MANAGER)
    await setPaymentMethodActive(2, false)
    commit({
      ...getState(),
      paymentMethods: getState().paymentMethods.map((method) => (method.id === 1 ? { ...method, name: 'Viejo' } : method)),
    })

    const result = await listPaymentMethods({ includeInactive: false })

    expect(getState().paymentMethods).toHaveLength(SEED_METHOD_COUNT)
    expect(getState().paymentMethods.find((method) => method.id === 1)?.name).toBe('Efectivo')
    expect(getState().paymentMethods.find((method) => method.id === 2)?.active).toBe(false)
    expect(result.status === 'ok' && result.data).toHaveLength(SEED_METHOD_COUNT - 1)
    expect(result.status === 'ok' && result.data.some((method) => method.id === 2)).toBe(false)
  })

  it('no toca el mock cuando Rust responde con error', async () => {
    const before = getState()

    await listPaymentMethods(ALL)

    expect(getState()).toBe(before)
  })

  it.each(['forbidden', 'sessionLocked', 'unauthenticated'] as const)(
    'entrega %s del backend intacto aunque el mock tenga sesión y datos',
    async (code) => {
      signInAs(MANAGER)
      thrownByIpc = appError(code)

      expect(await listPaymentMethods(ALL)).toEqual({ status: 'error', error: appError(code) })
    },
  )

  it('convierte un fallo del canal en internal', async () => {
    signInAs(MANAGER)
    thrownByIpc = new Error('canal caído')

    expect(await listPaymentMethods(ALL)).toMatchObject({ status: 'error', error: { code: 'internal' } })
  })
})

describe('createPaymentMethod', () => {
  it('rechaza sin sesión con unauthenticated', async () => {
    expect(await createPaymentMethod({ name: 'Cripto' })).toMatchObject({ status: 'error', error: { code: 'unauthenticated' } })
  })

  it.each([READER, 'recepcion'] as const)('rechaza a %s sin catalog.write y no escribe', async (username) => {
    signInAs(username)
    const before = getState()

    expect(await createPaymentMethod({ name: 'Cripto' })).toMatchObject({ status: 'error', error: { code: 'forbidden' } })
    expect(getState().paymentMethods).toBe(before.paymentMethods)
  })

  it('envía la entrada en la clave input del comando create_payment_method', async () => {
    signInAs(MANAGER)

    await createPaymentMethod({ name: 'Cripto' })

    expect(calls).toEqual([{ cmd: 'create_payment_method', args: { input: { name: 'Cripto' } } }])
  })

  it.each([['  '], ['Efectivo'], ['efectivo']])('mapea validation del campo name para %j y no toca el mock', async (name) => {
    signInAs(MANAGER)
    const before = getState()

    expect(await createPaymentMethod({ name })).toMatchObject({ status: 'error', error: { code: 'validation', field: 'name' } })
    expect(getState().paymentMethods).toBe(before.paymentMethods)
  })

  it('crea un método activo con id siguiente y nombre normalizado, y lo refleja en el mock', async () => {
    signInAs(MANAGER)
    const before = getState()

    const result = await createPaymentMethod({ name: '  Cripto  ' })

    expect(result).toEqual({ status: 'ok', data: { id: 6, name: 'Cripto', active: true } })
    expect(before.paymentMethods).toHaveLength(SEED_METHOD_COUNT)
    expect(getState().paymentMethods).toHaveLength(SEED_METHOD_COUNT + 1)
    expect(getState().paymentMethods.at(-1)).toEqual(methodOf(result))
  })

  it('convierte un fallo del canal en internal y no toca el mock', async () => {
    signInAs(MANAGER)
    thrownByIpc = new Error('canal caído')
    const before = getState()

    expect(await createPaymentMethod({ name: 'Cripto' })).toMatchObject({ status: 'error', error: { code: 'internal' } })
    expect(getState().paymentMethods).toBe(before.paymentMethods)
  })
})

describe('updatePaymentMethod', () => {
  it('rechaza sin sesión y sin catalog.write', async () => {
    expect(await updatePaymentMethod(1, { name: 'Nuevo' })).toMatchObject({ error: { code: 'unauthenticated' } })
    signInAs(READER)
    expect(await updatePaymentMethod(1, { name: 'Nuevo' })).toMatchObject({ error: { code: 'forbidden' } })
  })

  it('envía id y datos aplanados en la clave update del comando update_payment_method', async () => {
    signInAs(MANAGER)

    await updatePaymentMethod(1, { name: 'Nuevo' })

    expect(calls).toEqual([{ cmd: 'update_payment_method', args: { update: { id: 1, name: 'Nuevo' } } }])
  })

  it('un id inexistente llega como validation con field id y gana a los datos inválidos', async () => {
    signInAs(MANAGER)
    const before = getState()

    expect(await updatePaymentMethod(MISSING_ID, { name: '' })).toMatchObject({
      status: 'error',
      error: { code: 'validation', field: 'id' },
    })
    expect(getState().paymentMethods).toBe(before.paymentMethods)
  })

  it('mapea la unicidad del nombre como validation name', async () => {
    signInAs(MANAGER)

    expect(await updatePaymentMethod(1, { name: 'Zelle' })).toMatchObject({ error: { code: 'validation', field: 'name' } })
  })

  it('refleja el cambio en el mock sin mutar la fila previa', async () => {
    signInAs(MANAGER)
    const previousRow = getState().paymentMethods[0]

    const result = await updatePaymentMethod(1, { name: 'Efectivo USD' })

    expect(previousRow?.name).toBe('Efectivo')
    expect(result).toEqual({ status: 'ok', data: { id: 1, name: 'Efectivo USD', active: true } })
    expect(getState().paymentMethods.find((method) => method.id === 1)).toEqual(methodOf(result))
    expect(getState().paymentMethods).toHaveLength(SEED_METHOD_COUNT)
  })
})

describe('setPaymentMethodActive', () => {
  it('rechaza sin sesión y sin catalog.write', async () => {
    expect(await setPaymentMethodActive(1, false)).toMatchObject({ error: { code: 'unauthenticated' } })
    signInAs(READER)
    expect(await setPaymentMethodActive(1, false)).toMatchObject({ error: { code: 'forbidden' } })
  })

  it('envía id y active en la clave activation del comando set_payment_method_active', async () => {
    signInAs(MANAGER)

    await setPaymentMethodActive(1, false)

    expect(calls).toEqual([{ cmd: 'set_payment_method_active', args: { activation: { id: 1, active: false } } }])
  })

  it('un id inexistente es validation con field id', async () => {
    signInAs(MANAGER)

    expect(await setPaymentMethodActive(MISSING_ID, false)).toMatchObject({ error: { code: 'validation', field: 'id' } })
  })

  it('desactiva y reactiva reflejándolo en el mock sin borrar la fila', async () => {
    signInAs(MANAGER)

    await setPaymentMethodActive(1, false)
    expect(getState().paymentMethods.find((method) => method.id === 1)?.active).toBe(false)
    await setPaymentMethodActive(1, true)

    expect(getState().paymentMethods.find((method) => method.id === 1)?.active).toBe(true)
    expect(getState().paymentMethods).toHaveLength(SEED_METHOD_COUNT)
  })

  it('no toca los pagos existentes', async () => {
    signInAs(MANAGER)
    const before = getState().payments

    await setPaymentMethodActive(1, false)

    expect(getState().payments).toBe(before)
  })
})
