import { commands } from '@/lib/bindings'
import { callBackend } from '@/lib/ipc'
import { commit, getState } from '@/lib/mock/store'
import type { ExchangeRate, LocalDate, RateE4, Result } from '@/lib/model'

function withRate(rates: readonly ExchangeRate[], rate: ExchangeRate): readonly ExchangeRate[] {
  const isReplacement = rates.some((existing) => existing.date === rate.date)
  if (!isReplacement) return [...rates, rate]
  return rates.map((existing) => (existing.date === rate.date ? rate : existing))
}

function mirrorRates(rates: readonly ExchangeRate[]): void {
  const state = getState()
  commit({ ...state, rates: rates.reduce(withRate, state.rates) })
}

function mirrorOptionalRate(rate: ExchangeRate | null): void {
  if (rate !== null) mirrorRates([rate])
}

export function listRates(): Promise<Result<ExchangeRate[]>> {
  return callBackend(() => commands.listRates(), mirrorRates)
}

export function getRate(date: LocalDate): Promise<Result<ExchangeRate | null>> {
  return callBackend(() => commands.getRate(date), mirrorOptionalRate)
}

export function upsertRate(date: LocalDate, rateBsPerUsdE4: RateE4): Promise<Result<ExchangeRate>> {
  return callBackend(() => commands.upsertRate(date, rateBsPerUsdE4), (rate) => mirrorRates([rate]))
}
