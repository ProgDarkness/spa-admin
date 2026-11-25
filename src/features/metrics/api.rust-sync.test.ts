import { clearMocks } from '@tauri-apps/api/mocks'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { commit, getState, resetStore } from '@/lib/mock/store'
import { createPayment, voidPayment } from '@/features/payments/api'
import type { Payment } from '@/lib/model'
import { deferred } from '@/test/deferred'
import { appointmentTemplate, dataOf, errorOf, seedAppointments } from '@/test/appointment-fixtures'
import { installDevIpc } from '@/test/dev-ipc'
import { freezeDate } from '@/test/clock'
import { stubRustCatalog } from '@/test/rust-backend-stub'
import { signInAs } from '@/test/session'
import { getMonthlyMetrics } from './api'

beforeEach(() => {
  freezeDate('2026-11-12T09:00')
  resetStore()
  signInAs('propietaria')
})

afterEach(() => clearMocks())

describe('getMonthlyMetrics sincroniza las citas desde Rust', () => {
  it('cuenta las citas que devuelve Rust y no las del espejo', async () => {
    commit({ ...getState(), appointments: [] })
    stubRustCatalog({
      appointments: [
        appointmentTemplate({ id: 1, startsAt: '2026-11-03T10:00', endsAt: '2026-11-03T11:00', status: 'completed' }),
        appointmentTemplate({ id: 2, startsAt: '2026-11-05T10:00', endsAt: '2026-11-05T11:00', status: 'cancelled' }),
      ],
    })

    const metrics = dataOf(await getMonthlyMetrics('2026-11'))

    expect(metrics.appointments).toMatchObject({ completed: 1, cancelled: 1, scheduled: 0 })
  })

  it('devuelve el error de Rust y no calcula si list_all_appointments falla', async () => {
    stubRustCatalog({ failing: ['list_all_appointments'] })

    expect(errorOf(await getMonthlyMetrics('2026-11')).code).toBe('internal')
  })

  it('no consulta a Rust sin permiso ni con un mes inválido', async () => {
    const calls = stubRustCatalog({})

    await getMonthlyMetrics('2026-13')
    signInAs('recepcion')
    await getMonthlyMetrics('2026-11')

    expect(calls).toEqual([])
  })
})

function paymentOf(overrides: Partial<Payment>): Payment {
  return {
    id: 1,
    appointmentId: 1,
    methodId: 1,
    currency: 'USD',
    amountCents: 9_900,
    rateBsPerUsdE4: null,
    usdEquivalentCents: 9_900,
    paidAt: '2026-11-03T10:00',
    voidedAt: null,
    voidedBy: null,
    voidReason: null,
    ...overrides,
  }
}

const COMPLETED_IN_NOVEMBER = appointmentTemplate({
  id: 1,
  startsAt: '2026-11-03T10:00',
  endsAt: '2026-11-03T11:00',
  status: 'completed',
})

describe('getMonthlyMetrics sincroniza los pagos desde Rust', () => {
  it('refleja el pago creado en Rust y no el del seed del espejo', async () => {
    stubRustCatalog({ appointments: [COMPLETED_IN_NOVEMBER], payments: [paymentOf({ amountCents: 9_900 })] })

    const metrics = dataOf(await getMonthlyMetrics('2026-11'))

    expect(metrics.revenueByCurrency).toEqual({ USD: 9_900, VES: 0 })
  })

  it('ignora el pago anulado que devuelve Rust y separa lo cobrado en citas no completadas', async () => {
    const cancelled = appointmentTemplate({ id: 2, startsAt: '2026-11-05T10:00', endsAt: '2026-11-05T11:00', status: 'cancelled' })
    stubRustCatalog({
      appointments: [COMPLETED_IN_NOVEMBER, cancelled],
      payments: [
        paymentOf({ id: 1 }),
        paymentOf({ id: 2, amountCents: 500, voidedAt: '2026-11-03T11:00', voidedBy: 1, voidReason: 'error' }),
        paymentOf({ id: 3, appointmentId: 2, amountCents: 1_500 }),
      ],
    })

    const metrics = dataOf(await getMonthlyMetrics('2026-11'))

    expect(metrics.revenueByCurrency).toEqual({ USD: 9_900, VES: 0 })
    expect(metrics.collectedOnNonCompletedByCurrency).toEqual({ USD: 1_500, VES: 0 })
  })

  it('deja el espejo con los pagos de Rust', async () => {
    stubRustCatalog({ appointments: [COMPLETED_IN_NOVEMBER], payments: [paymentOf({ id: 42 })] })

    dataOf(await getMonthlyMetrics('2026-11'))

    expect(getState().payments.map((payment) => payment.id)).toEqual([42])
  })

  it('devuelve el error de Rust y no calcula si list_all_payments falla', async () => {
    stubRustCatalog({ appointments: [COMPLETED_IN_NOVEMBER], failing: ['list_all_payments'] })

    expect(errorOf(await getMonthlyMetrics('2026-11')).code).toBe('internal')
  })

  it('un rol con metrics.read y citas pero sin payments.read recibe forbidden', async () => {
    commit({
      ...getState(),
      users: getState().users.map((user) =>
        user.username === 'propietaria' ? { ...user, permissions: ['metrics.read', 'appointments.read'] } : user,
      ),
    })
    installDevIpc()

    expect(errorOf(await getMonthlyMetrics('2026-11')).code).toBe('forbidden')
  })

  it('consulta citas y pagos exactamente una vez cada uno', async () => {
    const calls = stubRustCatalog({ appointments: [COMPLETED_IN_NOVEMBER], payments: [] })

    dataOf(await getMonthlyMetrics('2026-11'))

    expect(calls.toSorted()).toEqual(['list_all_appointments', 'list_all_payments'])
  })
})

describe('getMonthlyMetrics con mutaciones de pagos en vuelo', () => {
  const NOVEMBER_COMPLETED_APPOINTMENT = 4
  const EXTRA_USD_CENTS = 5_000

  type InvokeHook = (cmd: string, args?: unknown) => Promise<unknown>

  function holdFirstPaymentListing(gate: Promise<void>): Promise<void> {
    const started = deferred<void>()
    const internals = Reflect.get(window, '__TAURI_INTERNALS__') as { invoke: InvokeHook }
    const original = internals.invoke
    let isPending = true
    internals.invoke = async (cmd, args) => {
      const value = await original(cmd, args)
      if (cmd === 'list_all_payments' && isPending) {
        isPending = false
        started.resolve()
        await gate
      }
      return value
    }
    return started.promise
  }

  const extraPayment = {
    appointmentId: NOVEMBER_COMPLETED_APPOINTMENT,
    methodId: 1,
    currency: 'USD',
    amountCents: EXTRA_USD_CENTS,
    rateBsPerUsdE4: null,
  } as const

  it('crear un pago mientras se calcula no produce totales parciales con ok', async () => {
    installDevIpc()
    const baseline = dataOf(await getMonthlyMetrics('2026-11')).revenueByCurrency.USD
    commit({ ...getState(), payments: [] })
    const gate = deferred<void>()
    const listingStarted = holdFirstPaymentListing(gate.promise)

    const pending = getMonthlyMetrics('2026-11')
    await listingStarted
    dataOf(await createPayment(extraPayment))
    gate.resolve()

    expect(dataOf(await pending).revenueByCurrency.USD).toBe(baseline + EXTRA_USD_CENTS)
  })

  it('anular un pago mientras se calcula no deja el total anterior con ok', async () => {
    installDevIpc()
    const created = dataOf(await createPayment(extraPayment))
    const withPayment = dataOf(await getMonthlyMetrics('2026-11')).revenueByCurrency.USD
    commit({ ...getState(), payments: [] })
    const gate = deferred<void>()
    const listingStarted = holdFirstPaymentListing(gate.promise)

    const pending = getMonthlyMetrics('2026-11')
    await listingStarted
    dataOf(await voidPayment(created.id, 'error'))
    gate.resolve()

    expect(dataOf(await pending).revenueByCurrency.USD).toBe(withPayment - EXTRA_USD_CENTS)
  })
})

describe('getMonthlyMetrics con citas lejanas y permisos', () => {
  it('calcula un mes de hace 8 meses con las citas traídas de Rust', async () => {
    seedAppointments(
      appointmentTemplate({ id: 1, startsAt: '2026-03-10T10:00', endsAt: '2026-03-10T11:00', status: 'completed' }),
    )
    commit({ ...getState(), appointments: [] })

    const metrics = dataOf(await getMonthlyMetrics('2026-03'))

    expect(metrics.appointments.completed).toBe(1)
  })

  it('un rol con metrics.read pero sin permiso de citas recibe forbidden de Rust y no un fallo', async () => {
    commit({
      ...getState(),
      users: getState().users.map((user) =>
        user.username === 'propietaria' ? { ...user, permissions: ['metrics.read'] } : user,
      ),
    })
    installDevIpc()

    expect(errorOf(await getMonthlyMetrics('2026-11')).code).toBe('forbidden')
  })
})
