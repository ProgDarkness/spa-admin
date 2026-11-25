import { beforeEach, describe, expect, it } from 'vitest'
import { commit, getState, resetStore } from '@/lib/mock/store'
import { freezeDate } from '@/test/clock'
import { installDevIpc } from '@/test/dev-ipc'
import { signInAs } from '@/test/session'
import { dataOf, errorOf } from '@/test/appointment-fixtures'
import { getMonthlyMetrics } from './api'

beforeEach(() => {
  freezeDate('2026-11-12T09:00')
  resetStore()
  installDevIpc()
})

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
  it.each(['2026-13', '26-11', '2026-00', 'noviembre'])('rechaza %s con field month', async (month) => {
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

describe('getMonthlyMetrics contra el seed con hoy 2026-11-12', () => {
  const OCTOBER_COMPLETED_APPOINTMENT_IDS = [1, 2, 8, 13, 14, 15]
  const OCTOBER_FIRST_COMPLETED_CLIENTS = [1, 2, 7, 9]

  beforeEach(() => signInAs('propietaria'))

  it('calcula octubre', async () => {
    expect(dataOf(await getMonthlyMetrics('2026-10'))).toEqual({
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
    })
  })

  it('un mes sin datos devuelve ceros', async () => {
    expect(dataOf(await getMonthlyMetrics('2025-01')).appointments.completed).toBe(0)
  })

  it('deja el store con las mismas filas tras sincronizar citas y pagos, sin importar su orden', async () => {
    const before = getState()

    await getMonthlyMetrics('2026-11')

    const byId = <T extends { id: number }>(rows: readonly T[]) => rows.toSorted((first, second) => first.id - second.id)
    const normalized = (state: typeof before) => ({
      ...state,
      appointments: byId(state.appointments),
      payments: byId(state.payments),
    })
    expect(normalized(getState())).toEqual(normalized(before))
    commit(before)
  })
})
