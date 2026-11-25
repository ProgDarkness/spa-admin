import { invoke } from '@tauri-apps/api/core'
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { commands, type AppErrorCode } from '@/lib/bindings'
import { createSeed } from '@/lib/mock/seed'
import type { SessionUser } from '@/lib/model'
import { createDevBackends } from './dev-backends'

const OWNER: SessionUser = {
  id: 1,
  username: 'dueña',
  roleName: 'Propietaria',
  permissions: ['payments.read', 'payments.write', 'clients.read', 'appointments.read', 'rates.manage', 'catalog.write'],
}
const PAYMENT_KEYS = [
  'amountCents',
  'appointmentId',
  'currency',
  'id',
  'methodId',
  'paidAt',
  'rateBsPerUsdE4',
  'usdEquivalentCents',
  'voidReason',
  'voidedAt',
  'voidedBy',
]
const HISTORY_KEYS = [
  'client',
  'collectedOnNonCompletedByCurrency',
  'entries',
  'paidByCurrency',
  'pendingByCurrency',
  'totalMinutes',
  'vesUsdEquivalentOfCompleted',
]
const ENTRY_KEYS = [
  'clientId',
  'durationMinSnapshot',
  'endsAt',
  'id',
  'notes',
  'payments',
  'priceCentsSnapshot',
  'resourceId',
  'resourceName',
  'serviceId',
  'serviceName',
  'startsAt',
  'status',
]
const ERROR_KEYS = ['code', 'entityIds', 'field', 'message']
const BINDINGS_ERROR_CODES: readonly AppErrorCode[] = [
  'invalidCredentials',
  'validation',
  'unauthenticated',
  'forbidden',
  'sessionLocked',
  'notFound',
  'nationalIdTaken',
  'clientDeletedReactivate',
  'overlap',
  'crossesMidnight',
  'invalidTransition',
  'resourceInactive',
  'resourceHasFutureAppointments',
  'rateMissing',
  'alreadyVoided',
  'internal',
]
const SEED = createSeed('2026-11-12')
const USD_INPUT = { appointmentId: 5, methodId: 1, currency: 'USD', amountCents: 1_000, rateBsPerUsdE4: null } as const

let session: SessionUser | null
let invoked: { cmd: string; args: unknown }[]

beforeEach(() => {
  session = OWNER
  invoked = []
  const backend = createDevBackends({
    auth: () => {
      throw new Error('IPC no simulado')
    },
    session: () => session,
    seed: { ...SEED, rates: [] },
  })
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
    await commands.listPayments(1)
    await commands.listAllPayments()
    await commands.createPayment(USD_INPUT)
    await commands.voidPayment({ id: 1, reason: 'error' })
    await commands.getClientHistory(1)

    expect(invoked.map((call) => [call.cmd, call.args === undefined ? [] : Object.keys(call.args as object)])).toEqual([
      ['list_payments', ['appointmentId']],
      ['list_all_payments', []],
      ['create_payment', ['input']],
      ['void_payment', ['request']],
      ['get_client_history', ['clientId']],
    ])
  })

  it('todo PaymentSummary devuelto tiene exactamente las claves del contrato', async () => {
    const created = await commands.createPayment(USD_INPUT)
    const voided = await commands.voidPayment({ id: 12, reason: 'error' })
    const listed = await commands.listAllPayments()
    const byAppointment = await commands.listPayments(5)

    const summaries = [
      ...[created, voided].flatMap((outcome) => (outcome.status === 'ok' ? [outcome.data] : [])),
      ...(listed.status === 'ok' ? listed.data : []),
      ...(byAppointment.status === 'ok' ? byAppointment.data : []),
    ]
    expect(summaries.length).toBeGreaterThan(12)
    summaries.forEach((summary) => expect(Object.keys(summary).sort()).toEqual(PAYMENT_KEYS))
    expect(created.status === 'ok' && created.data).toMatchObject({
      paidAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
      rateBsPerUsdE4: null,
      voidedAt: null,
    })
    expect(voided.status === 'ok' && voided.data).toMatchObject({
      voidedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
      voidedBy: OWNER.id,
      voidReason: 'error',
    })
  })

  it('el historial devuelto tiene las claves del contrato con entradas planas y sus pagos', async () => {
    const outcome = await commands.getClientHistory(1)

    expect(outcome.status).toBe('ok')
    if (outcome.status !== 'ok') return
    expect(Object.keys(outcome.data).sort()).toEqual(HISTORY_KEYS)
    expect(Object.keys(outcome.data.paidByCurrency).sort()).toEqual(['USD', 'VES'])
    expect(Object.keys(outcome.data.pendingByCurrency).sort()).toEqual(['USD', 'VES'])
    outcome.data.entries.forEach((entry) => expect(Object.keys(entry).sort()).toEqual(ENTRY_KEYS))
    outcome.data.entries.flatMap((entry) => entry.payments).forEach((payment) => {
      expect(Object.keys(payment).sort()).toEqual(PAYMENT_KEYS)
    })
  })

  it('los errores llevan las cuatro claves de AppError y un código existente en bindings', async () => {
    const rateMissing = await errorOf(() => commands.createPayment({ ...USD_INPUT, currency: 'VES' }))
    const reference = await errorOf(() => commands.createPayment({ ...USD_INPUT, appointmentId: 999 }))
    const validation = await errorOf(() => commands.createPayment({ ...USD_INPUT, amountCents: 0 }))
    const reason = await errorOf(() => commands.voidPayment({ id: 1, reason: ' ' }))
    const unknown = await errorOf(() => commands.voidPayment({ id: 999, reason: 'x' }))
    await commands.voidPayment({ id: 1, reason: 'primera' })
    const twice = await errorOf(() => commands.voidPayment({ id: 1, reason: 'segunda' }))
    const missingClient = await errorOf(() => commands.getClientHistory(999))
    session = null
    const unauthenticated = await errorOf(() => commands.listAllPayments())

    const errors = [rateMissing, reference, validation, reason, unknown, twice, missingClient, unauthenticated]
    errors.forEach((error) => {
      expect(Object.keys(error).sort()).toEqual(ERROR_KEYS)
      expect(BINDINGS_ERROR_CODES).toContain(error.code)
      expect(typeof error.message).toBe('string')
    })
    expect(rateMissing).toMatchObject({ code: 'rateMissing', field: 'rateBsPerUsdE4', entityIds: null })
    expect(reference).toMatchObject({ code: 'notFound', field: 'appointmentId', entityIds: null })
    expect(validation).toMatchObject({ code: 'validation', field: 'amountCents', entityIds: null })
    expect(reason).toMatchObject({ code: 'validation', field: 'reason', entityIds: null })
    expect(unknown).toMatchObject({ code: 'notFound', field: null, entityIds: null })
    expect(twice).toMatchObject({ code: 'alreadyVoided', field: null, entityIds: [1] })
    expect(missingClient).toMatchObject({ code: 'notFound', field: null, entityIds: null })
  })

  it('el rechazo del IPC crudo es el AppError y no un Error de JavaScript', async () => {
    session = null

    const rejection = await invoke('list_all_payments').catch((caught: unknown) => caught)

    expect(rejection).not.toBeInstanceOf(Error)
    expect(rejection).toMatchObject({ code: 'unauthenticated' })
  })
})
