import type { ExchangeRate } from '@/lib/bindings'
import type { SessionUser } from '@/lib/model'
import { MAX_RATE_E4 } from '@/lib/money'
import { isSupportedRateDate } from '@/features/rates/schemas'
import type { IpcBackend } from './auth-backend'
import { validationError } from './ipc-errors'
import { isRecord, requirePermission } from './record-backend-support'

export type RatesBackendOptions = {
  session: () => SessionUser | null
  rates: readonly ExchangeRate[]
}

const RATES_MANAGE = 'rates.manage'
const PAYMENTS_READ = 'payments.read'
const DATE_FIELD = 'date'
const RATE_FIELD = 'rateBsPerUsdE4'
const MIN_RATE_E4 = 1

function byDateDescending(first: ExchangeRate, second: ExchangeRate): number {
  return second.date.localeCompare(first.date)
}

function argumentOf(args: unknown, key: string): unknown {
  return isRecord(args) ? args[key] : undefined
}

function textArgument(args: unknown, key: string): string {
  const value = argumentOf(args, key)
  if (typeof value !== 'string') throw new Error(`argumento inválido: ${key}`)
  return value
}

function integerArgument(args: unknown, key: string): number {
  const value = argumentOf(args, key)
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new Error(`argumento inválido: ${key}`)
  return value
}

function requireSupportedDate(date: string): void {
  if (!isSupportedRateDate(date)) throw validationError(DATE_FIELD)
}

function requireRateInRange(rate: number): void {
  if (rate < MIN_RATE_E4 || rate > MAX_RATE_E4) throw validationError(RATE_FIELD)
}

export function createRatesIpcBackend(next: IpcBackend, options: RatesBackendOptions): IpcBackend {
  let rows: readonly ExchangeRate[] = options.rates.map((rate) => ({ ...rate }))

  function listRates(): ExchangeRate[] {
    requirePermission(options.session, RATES_MANAGE, PAYMENTS_READ)
    return rows.toSorted(byDateDescending)
  }

  function getRate(args: unknown): ExchangeRate | null {
    requirePermission(options.session, RATES_MANAGE, PAYMENTS_READ)
    const date = textArgument(args, DATE_FIELD)
    requireSupportedDate(date)
    return rows.find((row) => row.date === date) ?? null
  }

  function upsertRate(args: unknown): ExchangeRate {
    requirePermission(options.session, RATES_MANAGE)
    const date = textArgument(args, DATE_FIELD)
    const rateBsPerUsdE4 = integerArgument(args, RATE_FIELD)
    requireSupportedDate(date)
    requireRateInRange(rateBsPerUsdE4)
    const existing = rows.find((row) => row.date === date)
    if (existing?.rateBsPerUsdE4 === rateBsPerUsdE4) return existing
    const requested: ExchangeRate = { date, rateBsPerUsdE4 }
    rows = existing ? rows.map((row) => (row.date === date ? requested : row)) : [...rows, requested]
    return requested
  }

  const handlers: Readonly<Record<string, (args: unknown) => unknown>> = {
    list_rates: listRates,
    get_rate: getRate,
    upsert_rate: upsertRate,
  }

  return (cmd, args) => {
    const handler = Object.hasOwn(handlers, cmd) ? handlers[cmd] : undefined
    return handler ? handler(args) : next(cmd, args)
  }
}
