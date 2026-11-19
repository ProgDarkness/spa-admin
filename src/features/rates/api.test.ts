import { beforeEach, describe, expect, it } from 'vitest'
import { MAX_RATE_E4 } from '@/lib/money'
import { commit, getState, resetStore } from '@/lib/mock/store'
import { freezeDate } from '@/test/clock'
import { signInAs } from '@/test/session'
import { getRate, listRates, upsertRate } from './api'

const TODAY = '2026-11-12'

beforeEach(() => {
  freezeDate(`${TODAY}T09:00`)
  resetStore()
})

describe('listRates', () => {
  it('devuelve las tasas ordenadas por fecha descendente', async () => {
    signInAs('recepcion')

    const result = await listRates()

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    const dates = result.data.map((rate) => rate.date)
    expect(dates).toEqual([...dates].sort().reverse())
    expect(dates[0]).toBe(TODAY)
    expect(result.data).toHaveLength(7)
  })

  it('permite la lectura con payments.read sin rates.manage', async () => {
    signInAs('lectura')

    expect((await listRates()).status).toBe('ok')
  })

  it('exige sesión', async () => {
    expect(await listRates()).toMatchObject({ status: 'error', error: { code: 'unauthenticated' } })
  })

  it('no altera el orden ni la referencia del store', async () => {
    signInAs('recepcion')
    const before = getState().rates

    await listRates()

    expect(getState().rates).toBe(before)
  })
})

describe('getRate', () => {
  it('devuelve la tasa de la fecha pedida', async () => {
    signInAs('lectura')

    expect(await getRate(TODAY)).toEqual({ status: 'ok', data: { date: TODAY, rateBsPerUsdE4: 365000 } })
  })

  it('devuelve ok(null) cuando no hay tasa en esa fecha', async () => {
    signInAs('lectura')

    expect(await getRate('2030-01-01')).toEqual({ status: 'ok', data: null })
  })

  it('exige sesión', async () => {
    expect(await getRate(TODAY)).toMatchObject({ status: 'error', error: { code: 'unauthenticated' } })
  })

  it('rechaza usuarios sin permisos de lectura', async () => {
    signInAs('lectura')
    commit({
      ...getState(),
      users: getState().users.map((user) => ({ ...user, permissions: ['clients.read'] })),
    })

    expect(await getRate(TODAY)).toMatchObject({ status: 'error', error: { code: 'forbidden' } })
  })
})

describe('upsertRate', () => {
  it('crea la tasa de una fecha nueva', async () => {
    signInAs('recepcion')

    const result = await upsertRate('2030-01-01', 400000)

    expect(result).toEqual({ status: 'ok', data: { date: '2030-01-01', rateBsPerUsdE4: 400000 } })
    expect(getState().rates).toHaveLength(8)
  })

  it('reemplaza la tasa de una fecha existente sin duplicar ni borrar', async () => {
    signInAs('recepcion')
    const lengthBefore = getState().rates.length

    await upsertRate(TODAY, 370000)

    expect(getState().rates).toHaveLength(lengthBefore)
    expect(getState().rates.filter((rate) => rate.date === TODAY)).toEqual([
      { date: TODAY, rateBsPerUsdE4: 370000 },
    ])
  })

  it('no muta el arreglo ni las filas previas', async () => {
    signInAs('recepcion')
    const ratesBefore = getState().rates
    const todayRowBefore = ratesBefore.find((rate) => rate.date === TODAY)

    await upsertRate(TODAY, 370000)

    expect(getState().rates).not.toBe(ratesBefore)
    expect(todayRowBefore).toEqual({ date: TODAY, rateBsPerUsdE4: 365000 })
  })

  it('exige sesión', async () => {
    expect(await upsertRate(TODAY, 370000)).toMatchObject({ status: 'error', error: { code: 'unauthenticated' } })
  })

  it('prohíbe a quien solo puede leer y no cambia el store', async () => {
    signInAs('lectura')
    const before = getState()

    expect(await upsertRate(TODAY, 370000)).toMatchObject({ status: 'error', error: { code: 'forbidden' } })
    expect(getState()).toBe(before)
  })

  it.each([0, -1, 1.5, Number.NaN, MAX_RATE_E4 + 1])('rechaza la tasa %s con validation', async (rate) => {
    signInAs('recepcion')
    const before = getState()

    expect(await upsertRate(TODAY, rate)).toMatchObject({ status: 'error', error: { code: 'validation' } })
    expect(getState()).toBe(before)
  })

  it.each(['2026-02-31', '2026-13-45'])('rechaza la fecha inexistente %s sin tocar el store', async (date) => {
    signInAs('recepcion')
    const before = getState()

    expect(await upsertRate(date, 370000)).toMatchObject({
      status: 'error',
      error: { code: 'validation', field: 'date', message: 'Ingresa una fecha válida' },
    })
    expect(getState()).toBe(before)
  })

  it('rechaza una fecha inválida con validation', async () => {
    signInAs('recepcion')

    expect(await upsertRate('hoy', 370000)).toMatchObject({
      status: 'error',
      error: { code: 'validation', field: 'date' },
    })
  })
})
