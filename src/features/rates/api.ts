import { commands } from '@/lib/bindings'
import { callBackend } from '@/lib/ipc'
import { createMirrorSync } from '@/lib/mirror-sync'
import { commit, getState } from '@/lib/mock/store'
import type { ExchangeRate, LocalDate, RateE4, Result } from '@/lib/model'

const mirrorSync = createMirrorSync()

function withRate(rates: readonly ExchangeRate[], rate: ExchangeRate): readonly ExchangeRate[] {
  const isReplacement = rates.some((existing) => existing.date === rate.date)
  if (!isReplacement) return [...rates, rate]
  return rates.map((existing) => (existing.date === rate.date ? rate : existing))
}

function replaceRates(rates: readonly ExchangeRate[]): void {
  commit({ ...getState(), rates })
}

function mirrorRate(rate: ExchangeRate): void {
  const state = getState()
  commit({ ...state, rates: withRate(state.rates, rate) })
}

function mirrorOptionalRate(rate: ExchangeRate | null): void {
  if (rate !== null) mirrorRate(rate)
}

export function listRates(): Promise<Result<ExchangeRate[]>> {
  return mirrorSync.list(() => commands.listRates(), replaceRates)
}

export function getRate(date: LocalDate): Promise<Result<ExchangeRate | null>> {
  return callBackend(() => commands.getRate(date), mirrorOptionalRate)
}

export function upsertRate(date: LocalDate, rateBsPerUsdE4: RateE4): Promise<Result<ExchangeRate>> {
  return callBackend(() => commands.upsertRate(date, rateBsPerUsdE4), mirrorSync.reflectMutation(mirrorRate))
}
