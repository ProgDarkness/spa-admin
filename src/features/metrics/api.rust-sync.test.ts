import { clearMocks } from '@tauri-apps/api/mocks'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { commit, getState, resetStore } from '@/lib/mock/store'
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
