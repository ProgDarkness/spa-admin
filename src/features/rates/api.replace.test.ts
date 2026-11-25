import { clearMocks, mockIPC } from '@tauri-apps/api/mocks'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getState, resetStore } from '@/lib/mock/store'
import type { ExchangeRate } from '@/lib/model'
import { freezeDate } from '@/test/clock'
import { deferred } from '@/test/deferred'
import { getRate, listRates } from './api'

const TODAY = '2026-11-12'

function rustReturns(rates: readonly ExchangeRate[]): void {
  mockIPC((cmd) => (cmd === 'list_rates' ? rates : null))
}

beforeEach(() => {
  freezeDate(`${TODAY}T09:00`)
  resetStore()
})
afterEach(() => clearMocks())

describe('listRates reemplaza el espejo', () => {
  it('deja en el store exactamente lo que devuelve Rust', async () => {
    const fromRust = [{ date: TODAY, rateBsPerUsdE4: 999_000 }]
    rustReturns(fromRust)

    await listRates()

    expect(getState().rates).toEqual(fromRust)
  })

  it('vacía el store cuando Rust no devuelve tasas', async () => {
    rustReturns([])

    await listRates()

    expect(getState().rates).toEqual([])
  })

  it('getRate sigue haciendo upsert de la fecha sin tocar el resto', async () => {
    const before = getState().rates
    mockIPC((cmd) => (cmd === 'get_rate' ? { date: '2030-01-01', rateBsPerUsdE4: 1 } : null))

    await getRate('2030-01-01')

    expect(getState().rates).toHaveLength(before.length + 1)
  })

  it('un getRate concurrente no descarta el replace de un listRates en vuelo', async () => {
    const pendingList = deferred<unknown>()
    const fromRust = [{ date: TODAY, rateBsPerUsdE4: 777_000 }]
    mockIPC((cmd) => {
      if (cmd === 'list_rates') return pendingList.promise
      return cmd === 'get_rate' ? { date: '2030-01-01', rateBsPerUsdE4: 1 } : null
    })

    const slowList = listRates()
    await getRate('2030-01-01')
    pendingList.resolve(fromRust)
    await slowList

    expect(getState().rates).toEqual(fromRust)
  })

  it('getRate sin tasa no modifica el store', async () => {
    const before = getState().rates
    mockIPC(() => null)

    await getRate('2030-01-01')

    expect(getState().rates).toBe(before)
  })
})
