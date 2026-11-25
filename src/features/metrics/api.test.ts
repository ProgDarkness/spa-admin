import { clearMocks, mockIPC } from '@tauri-apps/api/mocks'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPayment } from '@/features/payments/api'
import { getState, resetStore } from '@/lib/mock/store'
import { dataOf, errorOf } from '@/test/appointment-fixtures'
import { freezeDate } from '@/test/clock'
import { installDevIpc } from '@/test/dev-ipc'
import { signInAs } from '@/test/session'
import { getMonthlyMetrics } from './api'

type InvokeHook = (cmd: string, args?: unknown) => Promise<unknown>

function recordInvokedCommands(): { cmd: string; args: unknown }[] {
  const internals = Reflect.get(window, '__TAURI_INTERNALS__') as { invoke: InvokeHook }
  const original = internals.invoke
  const calls: { cmd: string; args: unknown }[] = []
  internals.invoke = (cmd, args) => {
    calls.push({ cmd, args })
    return original(cmd, args)
  }
  return calls
}

beforeEach(() => {
  freezeDate('2026-11-12T09:00')
  resetStore()
  installDevIpc()
})

afterEach(() => clearMocks())

describe('getMonthlyMetrics autorización', () => {
  it('sin sesión responde unauthenticated', async () => {
    expect(errorOf(await getMonthlyMetrics('2026-11')).code).toBe('unauthenticated')
  })

  it.each(['recepcion', 'lectura'] as const)('%s sin metrics.read responde forbidden', async (username) => {
    signInAs(username)

    expect(errorOf(await getMonthlyMetrics('2026-11')).code).toBe('forbidden')
  })

  it('con metrics.read responde ok', async () => {
    signInAs('propietaria')

    expect(dataOf(await getMonthlyMetrics('2026-11')).month).toBe('2026-11')
  })
})

describe('getMonthlyMetrics validación', () => {
  it.each(['2026-13', '26-11', '2026-00', 'noviembre', '0000-01', '9999-12'])('rechaza %s con field month', async (month) => {
    signInAs('propietaria')

    const error = errorOf(await getMonthlyMetrics(month))

    expect(error.code).toBe('validation')
    expect(error.field).toBe('month')
  })

  it('la autorización se evalúa antes que la validación', async () => {
    signInAs('recepcion')

    expect(errorOf(await getMonthlyMetrics('2026-13')).code).toBe('forbidden')
  })
})

describe('getMonthlyMetrics delegación en Rust', () => {
  beforeEach(() => signInAs('propietaria'))

  it('invoca solo get_monthly_metrics con el mes pedido', async () => {
    const calls = recordInvokedCommands()

    dataOf(await getMonthlyMetrics('2026-11'))

    expect(calls).toEqual([{ cmd: 'get_monthly_metrics', args: { month: '2026-11' } }])
  })

  it('no modifica el store', async () => {
    const before = getState()

    dataOf(await getMonthlyMetrics('2026-11'))

    expect(getState()).toBe(before)
  })

  it('un fallo de canal se vuelve error interno', async () => {
    mockIPC(() => {
      throw new Error('canal caído')
    })

    expect(errorOf(await getMonthlyMetrics('2026-11')).code).toBe('internal')
  })
})

describe('getMonthlyMetrics contra el seed con hoy 2026-11-12', () => {
  const OCTOBER_COMPLETED_APPOINTMENT_IDS = [1, 2, 8, 13, 14, 15]
  const OCTOBER_FIRST_COMPLETED_CLIENTS = [1, 2, 7, 9]
  const SCHEDULED_NOVEMBER_APPOINTMENT = 12

  beforeEach(() => signInAs('propietaria'))

  it('calcula octubre', async () => {
    expect(dataOf(await getMonthlyMetrics('2026-10'))).toMatchObject({
      month: '2026-10',
      newClients: OCTOBER_FIRST_COMPLETED_CLIENTS.length,
      recurringClients: 0,
      appointments: { scheduled: 0, inProgress: 0, completed: OCTOBER_COMPLETED_APPOINTMENT_IDS.length, cancelled: 1, noShow: 1 },
      revenueByCurrency: { USD: 3500 + 12000 + 3500 + 1500, VES: 182500 + 73000 },
      collectedOnNonCompletedByCurrency: { USD: 0, VES: 0 },
    })
  })

  it('calcula noviembre', async () => {
    expect(dataOf(await getMonthlyMetrics('2026-11'))).toEqual({
      month: '2026-11',
      newClients: 1,
      recurringClients: 2,
      appointments: { scheduled: 2, inProgress: 1, completed: 3, cancelled: 1, noShow: 1 },
      revenueByCurrency: { USD: 2000 + 6000, VES: 73000 },
      collectedOnNonCompletedByCurrency: { USD: 1500, VES: 0 },
      pendingByCurrency: { USD: 0, VES: 0 },
    })
  })

  it('una seña creada en una cita programada del mes cae en pendiente y no en ingreso', async () => {
    dataOf(await createPayment({ appointmentId: SCHEDULED_NOVEMBER_APPOINTMENT, methodId: 1, currency: 'USD', amountCents: 2_500, rateBsPerUsdE4: null }))

    const metrics = dataOf(await getMonthlyMetrics('2026-11'))

    expect(metrics.pendingByCurrency).toEqual({ USD: 2_500, VES: 0 })
    expect(metrics.revenueByCurrency).toEqual({ USD: 8000, VES: 73000 })
  })

  it('un mes sin datos devuelve ceros', async () => {
    expect(dataOf(await getMonthlyMetrics('2025-01')).appointments.completed).toBe(0)
  })
})
