import { clearMocks, mockIPC } from '@tauri-apps/api/mocks'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { commands } from '@/lib/bindings'
import { settle } from '@/lib/ipc'
import { MAX_RATE_E4 } from '@/lib/money'
import { createSeed } from '@/lib/mock/seed'
import type { PermissionKey, SessionUser } from '@/lib/model'
import { createRatesIpcBackend } from './rates-backend'

const TODAY = '2026-11-12'
const SEED = createSeed(TODAY)
const SEED_RATE_COUNT = 7
const TODAY_RATE = 365_000
const NEW_DATE = '2030-01-01'

let session: SessionUser | null

function userWith(...permissions: PermissionKey[]): SessionUser {
  return { id: 50, username: 'tester', roleName: 'Prueba', permissions }
}

function failWhenUnrouted(command: string): never {
  throw new Error(`IPC no simulado: ${command}`)
}

beforeEach(() => {
  session = userWith('rates.manage')
  mockIPC(createRatesIpcBackend(failWhenUnrouted, { session: () => session, rates: SEED.rates }))
})

afterEach(() => clearMocks())

function validation(field: string) {
  return { status: 'error', error: { code: 'validation', field } }
}

async function listedDates(): Promise<string[]> {
  const listed = await commands.listRates()
  return listed.status === 'ok' ? listed.data.map((rate) => rate.date) : []
}

describe('autorización', () => {
  it('rechaza todos los comandos sin sesión con unauthenticated', async () => {
    session = null

    const outcomes = [
      await commands.listRates(),
      await commands.getRate(TODAY),
      await commands.upsertRate(TODAY, TODAY_RATE),
    ]

    outcomes.forEach((outcome) => expect(outcome).toMatchObject({ status: 'error', error: { code: 'unauthenticated' } }))
  })

  it.each([['rates.manage'], ['payments.read']] as const)('permite leer con solo %s', async (permission) => {
    session = userWith(permission)

    expect(await commands.listRates()).toMatchObject({ status: 'ok' })
    expect(await commands.getRate(TODAY)).toMatchObject({ status: 'ok' })
  })

  it('rechaza leer sin ninguno de los dos permisos con forbidden', async () => {
    session = userWith('catalog.read', 'payments.write')

    expect(await commands.listRates()).toMatchObject({ status: 'error', error: { code: 'forbidden' } })
    expect(await commands.getRate(TODAY)).toMatchObject({ status: 'error', error: { code: 'forbidden' } })
  })

  it('escribir exige rates.manage y no cambia nada con payments.read ni payments.write', async () => {
    session = userWith('payments.read', 'payments.write')

    const outcome = await commands.upsertRate(TODAY, 999_999)

    expect(outcome).toMatchObject({ status: 'error', error: { code: 'forbidden' } })
    session = userWith('rates.manage')
    expect(await commands.getRate(TODAY)).toEqual({ status: 'ok', data: { date: TODAY, rateBsPerUsdE4: TODAY_RATE } })
  })

  it('autoriza antes de validar', async () => {
    session = userWith('payments.read')

    expect(await commands.upsertRate('hoy', 0)).toMatchObject({ status: 'error', error: { code: 'forbidden' } })
  })
})

describe('listRates', () => {
  it('entrega las tasas del seed ordenadas por fecha descendente', async () => {
    const listed = await commands.listRates()

    expect(listed.status === 'ok' && listed.data).toHaveLength(SEED_RATE_COUNT)
    const dates = await listedDates()
    expect(dates).toEqual([...dates].sort().reverse())
    expect(dates[0]).toBe(TODAY)
  })

  it('mantiene el orden descendente tras insertar una fecha intermedia y una futura', async () => {
    await commands.upsertRate('2026-11-09', 111)
    await commands.upsertRate(NEW_DATE, 222)

    const dates = await listedDates()

    expect(dates[0]).toBe(NEW_DATE)
    expect(dates).toEqual([...dates].sort().reverse())
    expect(dates).toHaveLength(SEED_RATE_COUNT + 1)
  })

  it('entrega objetos con exactamente date y rateBsPerUsdE4', async () => {
    const listed = await commands.listRates()

    expect(listed.status === 'ok' && listed.data.every((rate) => Object.keys(rate).sort().join() === 'date,rateBsPerUsdE4')).toBe(
      true,
    )
  })
})

describe('getRate', () => {
  it('devuelve la tasa de la fecha pedida', async () => {
    expect(await commands.getRate(TODAY)).toEqual({ status: 'ok', data: { date: TODAY, rateBsPerUsdE4: TODAY_RATE } })
  })

  it.each(['2000-01-01', '2099-12-31', '2028-02-29'])('acepta la fecha límite o bisiesta %s sin tasa guardada', async (date) => {
    expect(await commands.getRate(date)).toEqual({ status: 'ok', data: null })
  })

  it('devuelve null y no error cuando esa fecha no tiene tasa', async () => {
    expect(await commands.getRate(NEW_DATE)).toEqual({ status: 'ok', data: null })
  })

  it.each(['hoy', '', '2026-02-31', '1999-12-31', '2100-01-01', '2026-1-1', '2026-11-12T09:00'])(
    'valida la fecha %j antes de buscar y reporta validation date',
    async (date) => {
      expect(await commands.getRate(date)).toMatchObject(validation('date'))
    },
  )
})

describe('upsertRate: fecha', () => {
  it.each(['hoy', '', '2026-02-31', '2026-13-45', '1999-12-31', '2100-01-01', '2026-1-1', '2026-11-12T09:00', ' 2026-11-12'])(
    'rechaza la fecha %j con validation date y no escribe',
    async (date) => {
      expect(await commands.upsertRate(date, 100)).toMatchObject(validation('date'))
      expect(await listedDates()).toHaveLength(SEED_RATE_COUNT)
    },
  )

  it.each(['2000-01-01', '2099-12-31', '2028-02-29', '2000-02-29'])('acepta la fecha límite o bisiesta %s', async (date) => {
    expect(await commands.upsertRate(date, 100)).toEqual({ status: 'ok', data: { date, rateBsPerUsdE4: 100 } })
  })

  it.each(['2027-02-29', '2026-02-29', '2000-02-30', '2028-02-30', '2026-04-31', '2026-00-10', '2026-01-00'])(
    'rechaza la fecha inexistente %s',
    async (date) => {
      expect(await commands.upsertRate(date, 100)).toMatchObject(validation('date'))
    },
  )

  it('valida la fecha antes que la tasa', async () => {
    expect(await commands.upsertRate('2026-02-31', 0)).toMatchObject(validation('date'))
  })
})

describe('upsertRate: tasa', () => {
  it.each([0, -1, MAX_RATE_E4 + 1])('rechaza la tasa %s con validation rateBsPerUsdE4', async (rate) => {
    expect(await commands.upsertRate(TODAY, rate)).toMatchObject(validation('rateBsPerUsdE4'))
    expect(await commands.getRate(TODAY)).toEqual({ status: 'ok', data: { date: TODAY, rateBsPerUsdE4: TODAY_RATE } })
  })

  it.each([1, MAX_RATE_E4])('acepta la tasa límite %s', async (rate) => {
    expect(await commands.upsertRate(NEW_DATE, rate)).toEqual({ status: 'ok', data: { date: NEW_DATE, rateBsPerUsdE4: rate } })
  })

  it.each([[1.5], [Number.NaN], ['36'], [null], [undefined]])(
    'la tasa %j que Rust rechazaría al deserializar un i64 se simula como fallo del canal',
    async (rate) => {
      const outcome = await settle(() => commands.upsertRate(TODAY, rate as never))

      expect(outcome).toMatchObject({ status: 'error', error: { code: 'internal' } })
    },
  )
})

describe('upsertRate: crear, actualizar y repetir', () => {
  it('una fecha nueva crea la tasa', async () => {
    const created = await commands.upsertRate(NEW_DATE, 400_000)

    expect(created).toEqual({ status: 'ok', data: { date: NEW_DATE, rateBsPerUsdE4: 400_000 } })
    expect(await listedDates()).toHaveLength(SEED_RATE_COUNT + 1)
    expect(await commands.getRate(NEW_DATE)).toEqual(created)
  })

  it('una fecha existente con otro valor actualiza sin duplicar filas', async () => {
    const updated = await commands.upsertRate(TODAY, 370_000)

    expect(updated).toEqual({ status: 'ok', data: { date: TODAY, rateBsPerUsdE4: 370_000 } })
    expect(await listedDates()).toHaveLength(SEED_RATE_COUNT)
    expect(await commands.getRate(TODAY)).toEqual(updated)
  })

  it('repetir el mismo valor devuelve la tasa existente y deja el listado idéntico', async () => {
    const before = await commands.listRates()

    const same = await commands.upsertRate(TODAY, TODAY_RATE)

    expect(same).toEqual({ status: 'ok', data: { date: TODAY, rateBsPerUsdE4: TODAY_RATE } })
    expect(await commands.listRates()).toEqual(before)
  })
})

describe('sin borrado y enrutamiento', () => {
  it('no atiende un comando de borrado: lo delega al siguiente backend', () => {
    const backend = createRatesIpcBackend(failWhenUnrouted, { session: () => session, rates: SEED.rates })

    expect(() => backend('delete_rate', { date: TODAY })).toThrow('IPC no simulado: delete_rate')
  })

  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])(
    'trata %s como comando desconocido y lo delega sin tocar el prototipo',
    (command) => {
      const backend = createRatesIpcBackend(failWhenUnrouted, { session: () => session, rates: SEED.rates })

      expect(() => backend(command, {})).toThrow(`IPC no simulado: ${command}`)
    },
  )

  it('delega en el siguiente backend los comandos que no son de tasas', async () => {
    clearMocks()
    mockIPC(
      createRatesIpcBackend((command) => (command === 'setup_status' ? { needsOwner: false, clockRollback: null } : null), {
        session: () => session,
        rates: SEED.rates,
      }),
    )

    expect(await commands.setupStatus()).toEqual({ status: 'ok', data: { needsOwner: false, clockRollback: null } })
  })

  it('el estado es propio de cada instancia y no muta el seed recibido', async () => {
    const other = createRatesIpcBackend(failWhenUnrouted, { session: () => session, rates: SEED.rates })
    await commands.upsertRate(NEW_DATE, 1)

    expect(other('list_rates', undefined)).toHaveLength(SEED_RATE_COUNT)
    expect(SEED.rates).toHaveLength(SEED_RATE_COUNT)
  })
})
