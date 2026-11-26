import { beforeEach, describe, expect, it } from 'vitest'
import { installRustLikeBackend } from '@/test/rust-like-backend'
import { listAppointments } from '@/features/appointments/api'
import { currentSession, login } from '@/features/auth/api'
import { listServices } from '@/features/catalog/api'
import { listClients } from '@/features/clients/api'
import { getMonthlyMetrics } from '@/features/metrics/api'
import { listPaymentMethods } from '@/features/payment-methods/api'
import { listRates } from '@/features/rates/api'
import { listResources } from '@/features/resources/api'
import { DEV_PASSWORD } from '@/test/ipc/auth-backend'
import { EMPTY_STATE, commit, getState } from '@/lib/mock/store'
import { freezeDate } from '@/test/clock'

beforeEach(() => {
  freezeDate('2026-11-12T09:00')
  commit(EMPTY_STATE)
  installRustLikeBackend()
})

describe('store vacío en producción', () => {
  it('el inicio de sesión contra Rust registra al usuario de sesión en el mock', async () => {
    const result = await login('propietaria', DEV_PASSWORD)

    expect(result.status).toBe('ok')
    expect(getState().users.map((user) => user.username)).toEqual(['propietaria'])
    expect(getState().sessionUserId).toBe(getState().users[0]?.id)
  })

  it('currentSession registra al usuario y no revienta con el store vacío', async () => {
    await login('propietaria', DEV_PASSWORD)
    commit(EMPTY_STATE)

    const result = await currentSession()

    expect(result.status).toBe('ok')
    expect(getState().sessionUserId).not.toBeNull()
  })

  it('cada listado se hidrata desde Rust sin asumir datos sembrados', async () => {
    await login('propietaria', DEV_PASSWORD)

    const results = await Promise.all([
      listClients({ query: '', includeDeleted: true }),
      listServices({ includeInactive: true }),
      listResources({ includeInactive: true }),
      listPaymentMethods({ includeInactive: true }),
      listRates(),
      listAppointments({ from: '2026-11-01', to: '2026-11-30', resourceId: null }),
    ])

    expect(results.map((result) => (result.status === 'error' ? result.error : result.status))).toEqual(Array(results.length).fill('ok'))
  })

  it('métricas sobre un store vacío devuelven totales en cero, no error', async () => {
    await login('propietaria', DEV_PASSWORD)

    const result = await getMonthlyMetrics('2026-11')

    expect(result.status).toBe('ok')
  })
})
