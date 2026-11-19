import { authorize, type PermissionRequirement } from '@/lib/mock/authorize'
import { commit, getState } from '@/lib/mock/store'
import type { ExchangeRate, LocalDate, RateE4, Result } from '@/lib/model'
import { ok, validationError } from '@/lib/result'
import { rateInputSchema } from './schemas'

const READ_REQUIREMENT: PermissionRequirement = { anyOf: ['rates.manage', 'payments.read'] }

function byDateDescending(a: ExchangeRate, b: ExchangeRate): number {
  return b.date.localeCompare(a.date)
}

function withRate(rates: readonly ExchangeRate[], rate: ExchangeRate): readonly ExchangeRate[] {
  const isReplacement = rates.some((existing) => existing.date === rate.date)
  if (!isReplacement) return [...rates, rate]
  return rates.map((existing) => (existing.date === rate.date ? rate : existing))
}

export async function listRates(): Promise<Result<ExchangeRate[]>> {
  const state = getState()
  const access = authorize(state, READ_REQUIREMENT)
  if (access.status === 'error') return access
  return ok([...state.rates].sort(byDateDescending))
}

export async function getRate(date: LocalDate): Promise<Result<ExchangeRate | null>> {
  const state = getState()
  const access = authorize(state, READ_REQUIREMENT)
  if (access.status === 'error') return access
  return ok(state.rates.find((rate) => rate.date === date) ?? null)
}

export async function upsertRate(date: LocalDate, rateBsPerUsdE4: RateE4): Promise<Result<ExchangeRate>> {
  const state = getState()
  const access = authorize(state, 'rates.manage')
  if (access.status === 'error') return access
  const parsed = rateInputSchema.safeParse({ date, rateBsPerUsdE4 })
  if (!parsed.success) return validationError(parsed.error.issues)
  commit({ ...state, rates: withRate(state.rates, parsed.data) })
  return ok(parsed.data)
}
