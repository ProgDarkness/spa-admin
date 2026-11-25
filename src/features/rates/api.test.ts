import { clearMocks, mockIPC } from '@tauri-apps/api/mocks'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { currentUser } from '@/lib/mock/authorize'
import { MAX_RATE_E4 } from '@/lib/money'
import { commit, getState, resetStore } from '@/lib/mock/store'
import type { AppError } from '@/lib/model'
import { freezeDate } from '@/test/clock'
import { createRatesIpcBackend } from '@/test/ipc/rates-backend'
import { signInAs } from '@/test/session'
import { getRate, listRates, upsertRate } from './api'

const TODAY = '2026-11-12'
const TODAY_RATE = 365_000
const SEED_RATE_COUNT = 7

let calls: { cmd: string; args: unknown }[]
let thrownByIpc: unknown

function installRatesIpc(): void {
  const backend = createRatesIpcBackend(
    (cmd) => {
      throw new Error(`IPC no simulado: ${cmd}`)
    },
    { session: () => currentUser(getState()), rates: getState().rates },
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

function mockRatesOn(date: string) {
  return getState().rates.filter((rate) => rate.date === date)
}

beforeEach(() => {
  freezeDate(`${TODAY}T09:00`)
  resetStore()
  calls = []
  thrownByIpc = undefined
  installRatesIpc()
})

afterEach(() => clearMocks())

describe('listRates', () => {
  it('devuelve las tasas ordenadas por fecha descendente', async () => {
    signInAs('recepcion')

    const result = await listRates()

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    const dates = result.data.map((rate) => rate.date)
    expect(dates).toEqual([...dates].sort().reverse())
    expect(dates[0]).toBe(TODAY)
    expect(result.data).toHaveLength(SEED_RATE_COUNT)
  })

  it('invoca list_rates sin argumentos', async () => {
    signInAs('recepcion')

    await listRates()

    expect(calls).toEqual([{ cmd: 'list_rates', args: {} }])
  })

  it('permite la lectura con payments.read sin rates.manage', async () => {
    signInAs('lectura')

    expect((await listRates()).status).toBe('ok')
  })

  it('exige sesión y no devuelve los datos del mock', async () => {
    expect(await listRates()).toMatchObject({ status: 'error', error: { code: 'unauthenticated' } })
  })

  it('rechaza sin rates.manage ni payments.read con forbidden', async () => {
    signInAs('lectura')
    commit({ ...getState(), users: getState().users.map((user) => ({ ...user, permissions: ['clients.read'] })) })

    expect(await listRates()).toMatchObject({ status: 'error', error: { code: 'forbidden' } })
  })

  it('refleja en el mock lo que dice Rust sin duplicar filas por fecha', async () => {
    signInAs('recepcion')
    commit({
      ...getState(),
      rates: getState().rates.map((rate) => (rate.date === TODAY ? { ...rate, rateBsPerUsdE4: 1 } : rate)),
    })

    await listRates()

    expect(getState().rates).toHaveLength(SEED_RATE_COUNT)
    expect(mockRatesOn(TODAY)).toEqual([{ date: TODAY, rateBsPerUsdE4: TODAY_RATE }])
  })

  it('no toca el mock cuando Rust responde con error', async () => {
    const before = getState()

    await listRates()

    expect(getState()).toBe(before)
  })

  it.each(['forbidden', 'sessionLocked', 'unauthenticated'] as const)('entrega %s del backend intacto', async (code) => {
    signInAs('recepcion')
    thrownByIpc = appError(code)

    expect(await listRates()).toEqual({ status: 'error', error: appError(code) })
  })

  it('convierte un fallo del canal en internal', async () => {
    signInAs('recepcion')
    thrownByIpc = new Error('canal caído')

    expect(await listRates()).toMatchObject({ status: 'error', error: { code: 'internal' } })
  })
})

describe('getRate', () => {
  it('devuelve la tasa de la fecha pedida enviando la clave date a get_rate', async () => {
    signInAs('lectura')

    expect(await getRate(TODAY)).toEqual({ status: 'ok', data: { date: TODAY, rateBsPerUsdE4: TODAY_RATE } })
    expect(calls).toEqual([{ cmd: 'get_rate', args: { date: TODAY } }])
  })

  it('devuelve ok(null) cuando no hay tasa en esa fecha y no toca el mock', async () => {
    signInAs('lectura')
    const before = getState()

    expect(await getRate('2030-01-01')).toEqual({ status: 'ok', data: null })
    expect(getState()).toBe(before)
  })

  it('refleja en el mock una tasa que Rust conoce y el mock no', async () => {
    signInAs('lectura')
    commit({ ...getState(), rates: getState().rates.filter((rate) => rate.date !== TODAY) })

    await getRate(TODAY)

    expect(mockRatesOn(TODAY)).toEqual([{ date: TODAY, rateBsPerUsdE4: TODAY_RATE }])
  })

  it('exige sesión', async () => {
    expect(await getRate(TODAY)).toMatchObject({ status: 'error', error: { code: 'unauthenticated' } })
  })

  it('rechaza usuarios sin permisos de lectura', async () => {
    signInAs('lectura')
    commit({ ...getState(), users: getState().users.map((user) => ({ ...user, permissions: ['clients.read'] })) })

    expect(await getRate(TODAY)).toMatchObject({ status: 'error', error: { code: 'forbidden' } })
  })

  it.each(['2026-02-31', 'hoy', '1999-12-31'])('una fecha inválida %j llega como validation date', async (date) => {
    signInAs('lectura')

    expect(await getRate(date)).toMatchObject({ status: 'error', error: { code: 'validation', field: 'date' } })
  })

  it.each(['forbidden', 'sessionLocked', 'unauthenticated'] as const)('entrega %s del backend intacto', async (code) => {
    signInAs('lectura')
    thrownByIpc = appError(code)

    expect(await getRate(TODAY)).toEqual({ status: 'error', error: appError(code) })
  })
})

describe('upsertRate', () => {
  it('crea la tasa de una fecha nueva y la refleja en el mock', async () => {
    signInAs('recepcion')

    const result = await upsertRate('2030-01-01', 400_000)

    expect(result).toEqual({ status: 'ok', data: { date: '2030-01-01', rateBsPerUsdE4: 400_000 } })
    expect(getState().rates).toHaveLength(SEED_RATE_COUNT + 1)
    expect(mockRatesOn('2030-01-01')).toEqual([{ date: '2030-01-01', rateBsPerUsdE4: 400_000 }])
  })

  it('envía date y rateBsPerUsdE4 como argumentos de upsert_rate', async () => {
    signInAs('recepcion')

    await upsertRate(TODAY, 370_000)

    expect(calls).toEqual([{ cmd: 'upsert_rate', args: { date: TODAY, rateBsPerUsdE4: 370_000 } }])
  })

  it('reemplaza la tasa de una fecha existente sin duplicar ni borrar', async () => {
    signInAs('recepcion')

    await upsertRate(TODAY, 370_000)

    expect(getState().rates).toHaveLength(SEED_RATE_COUNT)
    expect(mockRatesOn(TODAY)).toEqual([{ date: TODAY, rateBsPerUsdE4: 370_000 }])
  })

  it('repetir el mismo valor deja el mock con la misma tasa y sin filas nuevas', async () => {
    signInAs('recepcion')

    const result = await upsertRate(TODAY, TODAY_RATE)

    expect(result).toEqual({ status: 'ok', data: { date: TODAY, rateBsPerUsdE4: TODAY_RATE } })
    expect(getState().rates).toHaveLength(SEED_RATE_COUNT)
  })

  it('no muta el arreglo ni las filas previas del mock', async () => {
    signInAs('recepcion')
    const ratesBefore = getState().rates
    const todayRowBefore = ratesBefore.find((rate) => rate.date === TODAY)

    await upsertRate(TODAY, 370_000)

    expect(getState().rates).not.toBe(ratesBefore)
    expect(todayRowBefore).toEqual({ date: TODAY, rateBsPerUsdE4: TODAY_RATE })
  })

  it('exige sesión', async () => {
    expect(await upsertRate(TODAY, 370_000)).toMatchObject({ status: 'error', error: { code: 'unauthenticated' } })
  })

  it('prohíbe a quien solo puede leer y no cambia el mock', async () => {
    signInAs('lectura')
    const before = getState()

    expect(await upsertRate(TODAY, 370_000)).toMatchObject({ status: 'error', error: { code: 'forbidden' } })
    expect(getState()).toBe(before)
  })

  it.each([0, -1, MAX_RATE_E4 + 1])('la tasa %s llega como validation rateBsPerUsdE4 y no toca el mock', async (rate) => {
    signInAs('recepcion')
    const before = getState()

    expect(await upsertRate(TODAY, rate)).toMatchObject({
      status: 'error',
      error: { code: 'validation', field: 'rateBsPerUsdE4' },
    })
    expect(getState()).toBe(before)
  })

  it.each(['2026-02-31', '2026-13-45', 'hoy', '1999-12-31', '2100-01-01'])(
    'la fecha %j llega como validation date y no toca el mock',
    async (date) => {
      signInAs('recepcion')
      const before = getState()

      expect(await upsertRate(date, 370_000)).toMatchObject({
        status: 'error',
        error: { code: 'validation', field: 'date' },
      })
      expect(getState()).toBe(before)
    },
  )

  it.each(['forbidden', 'sessionLocked', 'unauthenticated'] as const)('entrega %s del backend intacto', async (code) => {
    signInAs('recepcion')
    thrownByIpc = appError(code)

    expect(await upsertRate(TODAY, 370_000)).toEqual({ status: 'error', error: appError(code) })
  })

  it('convierte un fallo del canal en internal y no toca el mock', async () => {
    signInAs('recepcion')
    thrownByIpc = new Error('canal caído')
    const before = getState()

    expect(await upsertRate(TODAY, 370_000)).toMatchObject({ status: 'error', error: { code: 'internal' } })
    expect(getState().rates).toBe(before.rates)
  })
})
