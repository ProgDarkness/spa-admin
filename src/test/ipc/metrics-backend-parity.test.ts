import { invoke } from '@tauri-apps/api/core'
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { commands, type AppErrorCode } from '@/lib/bindings'
import { createSeed } from '@/lib/mock/seed'
import type { SessionUser } from '@/lib/model'
import { createDevBackends } from './dev-backends'

const OWNER: SessionUser = { id: 1, username: 'dueña', roleName: 'Propietaria', permissions: ['metrics.read'] }
const METRICS_KEYS = [
  'appointments',
  'collectedOnNonCompletedByCurrency',
  'month',
  'newClients',
  'pendingByCurrency',
  'recurringClients',
  'revenueByCurrency',
]
const COUNT_KEYS = ['cancelled', 'completed', 'inProgress', 'noShow', 'scheduled']
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
const SEED_MONTH = '2026-11'

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
    seed: SEED,
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
  it('el comando viaja con el nombre y la clave de argumento del contrato', async () => {
    await commands.getMonthlyMetrics(SEED_MONTH)

    expect(invoked.map((call) => [call.cmd, Object.keys(call.args as object)])).toEqual([['get_monthly_metrics', ['month']]])
  })

  it('las métricas devueltas tienen exactamente las claves del contrato y reflejan el seed', async () => {
    const outcome = await commands.getMonthlyMetrics(SEED_MONTH)

    expect(outcome.status).toBe('ok')
    if (outcome.status !== 'ok') return
    expect(Object.keys(outcome.data).sort()).toEqual(METRICS_KEYS)
    expect(Object.keys(outcome.data.appointments).sort()).toEqual(COUNT_KEYS)
    for (const bucket of [outcome.data.revenueByCurrency, outcome.data.collectedOnNonCompletedByCurrency, outcome.data.pendingByCurrency]) {
      expect(Object.keys(bucket).sort()).toEqual(['USD', 'VES'])
    }
    const total = Object.values(outcome.data.appointments).reduce((sum, count) => sum + count, 0)
    expect(total).toBe(SEED.appointments.filter((row) => row.startsAt.startsWith(SEED_MONTH)).length)
    expect(total).toBeGreaterThan(0)
  })

  it('los errores llevan las cuatro claves de AppError y un código existente en bindings', async () => {
    const validation = await errorOf(() => commands.getMonthlyMetrics('2026-13'))
    session = { ...OWNER, permissions: ['clients.read'] }
    const forbidden = await errorOf(() => commands.getMonthlyMetrics(SEED_MONTH))
    session = null
    const unauthenticated = await errorOf(() => commands.getMonthlyMetrics(SEED_MONTH))

    for (const error of [validation, forbidden, unauthenticated]) {
      expect(Object.keys(error).sort()).toEqual(ERROR_KEYS)
      expect(BINDINGS_ERROR_CODES).toContain(error.code)
      expect(typeof error.message).toBe('string')
    }
    expect(validation).toMatchObject({ code: 'validation', field: 'month', entityIds: null })
    expect(forbidden).toMatchObject({ code: 'forbidden', field: null, entityIds: null })
    expect(unauthenticated).toMatchObject({ code: 'unauthenticated', field: null, entityIds: null })
  })

  it('el rechazo del IPC crudo es el AppError y no un Error de JavaScript', async () => {
    session = null

    const rejection = await invoke('get_monthly_metrics', { month: SEED_MONTH }).catch((caught: unknown) => caught)

    expect(rejection).not.toBeInstanceOf(Error)
    expect(rejection).toMatchObject({ code: 'unauthenticated' })
  })
})
