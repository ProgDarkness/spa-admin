import { invoke } from '@tauri-apps/api/core'
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { commands, type AppErrorCode } from '@/lib/bindings'
import { createSeed } from '@/lib/mock/seed'
import type { SessionUser } from '@/lib/model'
import { createRatesIpcBackend } from './rates-backend'

const MANAGER: SessionUser = { id: 1, username: 'dueña', roleName: 'Propietaria', permissions: ['rates.manage'] }
const RATE_KEYS = ['date', 'rateBsPerUsdE4']
const ERROR_KEYS = ['code', 'entityIds', 'field', 'message']
const BINDINGS_ERROR_CODES: readonly AppErrorCode[] = [
  'invalidCredentials',
  'validation',
  'unauthenticated',
  'forbidden',
  'sessionLocked',
  'internal',
]

let session: SessionUser | null
let invoked: { cmd: string; args: unknown }[]

beforeEach(() => {
  session = MANAGER
  invoked = []
  const backend = createRatesIpcBackend(
    (cmd) => {
      throw new Error(`IPC no simulado: ${cmd}`)
    },
    { session: () => session, rates: createSeed('2026-11-12').rates },
  )
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
  it('cada comando viaja con el nombre y las claves de argumento del contrato', async () => {
    await commands.listRates()
    await commands.getRate('2026-11-12')
    await commands.upsertRate('2026-11-12', 1)

    expect(invoked.map((call) => [call.cmd, call.args === undefined ? [] : Object.keys(call.args as object)])).toEqual([
      ['list_rates', []],
      ['get_rate', ['date']],
      ['upsert_rate', ['date', 'rateBsPerUsdE4']],
    ])
  })

  it('toda ExchangeRate devuelta tiene exactamente las claves del contrato', async () => {
    const listed = await commands.listRates()
    const found = await commands.getRate('2026-11-12')
    const upserted = await commands.upsertRate('2030-01-01', 5)

    const rates = [
      ...(listed.status === 'ok' ? listed.data : []),
      ...[found, upserted].flatMap((outcome) => (outcome.status === 'ok' && outcome.data ? [outcome.data] : [])),
    ]
    expect(rates.length).toBeGreaterThan(8)
    rates.forEach((rate) => expect(Object.keys(rate).sort()).toEqual(RATE_KEYS))
  })

  it('los tipos de cada campo coinciden con el contrato', async () => {
    const upserted = await commands.upsertRate('2030-01-01', 5)

    expect(upserted.status === 'ok' && upserted.data).toMatchObject({
      date: expect.any(String),
      rateBsPerUsdE4: expect.any(Number),
    })
  })

  it('getRate sin tasa devuelve null del contrato y no un error', async () => {
    expect(await commands.getRate('2030-01-01')).toEqual({ status: 'ok', data: null })
  })

  it('los errores llevan las cuatro claves de AppError y un código existente en bindings', async () => {
    const validation = await errorOf(() => commands.upsertRate('hoy', 1))
    session = null
    const unauthenticated = await errorOf(() => commands.listRates())
    session = { ...MANAGER, permissions: [] }
    const forbidden = await errorOf(() => commands.listRates())

    ;[validation, unauthenticated, forbidden].forEach((error) => {
      expect(Object.keys(error).sort()).toEqual(ERROR_KEYS)
      expect(BINDINGS_ERROR_CODES).toContain(error.code)
      expect(typeof error.message).toBe('string')
    })
    expect(validation).toMatchObject({ code: 'validation', field: 'date', entityIds: null })
    expect(unauthenticated).toMatchObject({ code: 'unauthenticated', field: null, entityIds: null })
    expect(forbidden).toMatchObject({ code: 'forbidden', field: null, entityIds: null })
  })

  it('el rechazo del IPC crudo es el AppError y no un Error de JavaScript', async () => {
    session = null

    const rejection = await invoke('list_rates').catch((caught: unknown) => caught)

    expect(rejection).not.toBeInstanceOf(Error)
    expect(rejection).toMatchObject({ code: 'unauthenticated' })
  })
})
