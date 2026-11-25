import { invoke } from '@tauri-apps/api/core'
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { commands, type AppErrorCode } from '@/lib/bindings'
import { createSeed } from '@/lib/mock/seed'
import type { SessionUser } from '@/lib/model'
import { createPaymentMethodsIpcBackend } from './payment-methods-backend'

const OWNER: SessionUser = { id: 1, username: 'dueña', roleName: 'Propietaria', permissions: ['catalog.read', 'catalog.write'] }
const SUMMARY_KEYS = ['active', 'createdAt', 'id', 'name', 'updatedAt']
const ERROR_KEYS = ['code', 'entityIds', 'field', 'message']
const BINDINGS_ERROR_CODES: readonly AppErrorCode[] = [
  'invalidCredentials',
  'validation',
  'unauthenticated',
  'forbidden',
  'sessionLocked',
  'internal',
]

let session: SessionUser | null
let invoked: { cmd: string; args: unknown }[]

beforeEach(() => {
  session = OWNER
  invoked = []
  const backend = createPaymentMethodsIpcBackend(
    (cmd) => {
      throw new Error(`IPC no simulado: ${cmd}`)
    },
    { session: () => session, paymentMethods: createSeed('2026-11-12').paymentMethods },
  )
  mockIPC((cmd, args) => {
    invoked.push({ cmd, args })
    return backend(cmd, args)
  })
})

afterEach(() => clearMocks())

async function errorOf(operation: () => Promise<{ status: string; error?: unknown }>): Promise<Record<string, unknown>> {
  const outcome = await operation()
  if (outcome.status !== 'error' || typeof outcome.error !== 'object' || outcome.error === null) {
    throw new Error('se esperaba un error')
  }
  return outcome.error as Record<string, unknown>
}

describe('paridad de forma con los bindings generados', () => {
  it('cada comando viaja con el nombre y la clave de argumento del contrato', async () => {
    await commands.listPaymentMethods({ includeInactive: true })
    await commands.createPaymentMethod({ name: 'Nuevo' })
    await commands.updatePaymentMethod({ id: 1, name: 'Otro' })
    await commands.setPaymentMethodActive({ id: 1, active: false })

    expect(invoked.map((call) => [call.cmd, Object.keys(call.args as object)])).toEqual([
      ['list_payment_methods', ['filter']],
      ['create_payment_method', ['input']],
      ['update_payment_method', ['update']],
      ['set_payment_method_active', ['activation']],
    ])
  })

  it('todo PaymentMethodSummary devuelto tiene exactamente las claves del contrato', async () => {
    const listed = await commands.listPaymentMethods({ includeInactive: true })
    const created = await commands.createPaymentMethod({ name: 'Nuevo' })
    const updated = await commands.updatePaymentMethod({ id: 1, name: 'Otro' })
    const toggled = await commands.setPaymentMethodActive({ id: 1, active: false })

    const summaries = [
      ...(listed.status === 'ok' ? listed.data : []),
      ...[created, updated, toggled].flatMap((outcome) => (outcome.status === 'ok' ? [outcome.data] : [])),
    ]
    expect(summaries.length).toBeGreaterThan(5)
    summaries.forEach((summary) => expect(Object.keys(summary).sort()).toEqual(SUMMARY_KEYS))
  })

  it('los tipos de cada campo del resumen coinciden con el contrato', async () => {
    const created = await commands.createPaymentMethod({ name: 'Nuevo' })

    expect(created.status === 'ok' && created.data).toMatchObject({
      id: expect.any(Number),
      name: expect.any(String),
      active: expect.any(Boolean),
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    })
  })

  it('los errores llevan las cuatro claves de AppError y un código existente en bindings', async () => {
    const validation = await errorOf(() => commands.createPaymentMethod({ name: '' }))
    session = null
    const unauthenticated = await errorOf(() => commands.listPaymentMethods({ includeInactive: true }))
    session = { ...OWNER, permissions: [] }
    const forbidden = await errorOf(() => commands.listPaymentMethods({ includeInactive: true }))

    ;[validation, unauthenticated, forbidden].forEach((error) => {
      expect(Object.keys(error).sort()).toEqual(ERROR_KEYS)
      expect(BINDINGS_ERROR_CODES).toContain(error.code)
      expect(typeof error.message).toBe('string')
    })
    expect(validation).toMatchObject({ code: 'validation', field: 'name', entityIds: null })
    expect(unauthenticated).toMatchObject({ code: 'unauthenticated', field: null, entityIds: null })
    expect(forbidden).toMatchObject({ code: 'forbidden', field: null, entityIds: null })
  })

  it('nunca emite notFound: un id inexistente es validation con field id', async () => {
    const missing = await errorOf(() => commands.setPaymentMethodActive({ id: 999, active: true }))

    expect(missing).toMatchObject({ code: 'validation', field: 'id' })
    expect(missing.code).not.toBe('notFound')
  })

  it('el rechazo del IPC crudo es el AppError y no un Error de JavaScript', async () => {
    session = null

    const rejection = await invoke('list_payment_methods', { filter: { includeInactive: true } }).catch(
      (caught: unknown) => caught,
    )

    expect(rejection).not.toBeInstanceOf(Error)
    expect(rejection).toMatchObject({ code: 'unauthenticated' })
  })
})
