import type { AmountsByCurrency, Cents, Currency, RateE4 } from './model'

export const RATE_SCALE = 10_000
export const MAX_AMOUNT_CENTS = 100_000_000_000
export const MAX_RATE_E4 = 100_000_000_000

const RATE_DECIMALS = 4
const CENTS_DECIMALS = 2
const RATE_SCALE_BIG = BigInt(RATE_SCALE)

function isNonNegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0
}

export function usdEquivalentCents(amountVesCents: Cents, rate: RateE4): Cents {
  if (!isNonNegativeSafeInteger(amountVesCents)) throw new RangeError('amountVesCents debe ser un entero seguro no negativo')
  if (!isNonNegativeSafeInteger(rate) || rate === 0) throw new RangeError('rate debe ser un entero seguro positivo')
  const rateBig = BigInt(rate)
  const roundedHalfUp = (2n * BigInt(amountVesCents) * RATE_SCALE_BIG + rateBig) / (2n * rateBig)
  const result = Number(roundedHalfUp)
  if (!Number.isSafeInteger(result)) throw new RangeError('el equivalente excede el rango seguro')
  return result
}

function parseScaledDecimal(text: string, decimals: number, max: number): number | null {
  const match = new RegExp(`^(\\d+)(?:[.,](\\d{1,${decimals}}))?$`).exec(text.trim())
  if (!match) return null
  const [, integerPart = '', fractionPart = ''] = match
  const scaled = Number(integerPart + fractionPart.padEnd(decimals, '0'))
  return Number.isSafeInteger(scaled) && scaled <= max ? scaled : null
}

export function parseRateE4(text: string): RateE4 | null {
  const parsed = parseScaledDecimal(text, RATE_DECIMALS, MAX_RATE_E4)
  return parsed === null || parsed === 0 ? null : parsed
}

export function formatRateE4(rate: RateE4): string {
  return new Intl.NumberFormat('es-VE', {
    minimumFractionDigits: CENTS_DECIMALS,
    maximumFractionDigits: RATE_DECIMALS,
  }).format(rate / RATE_SCALE)
}

export function parseCents(text: string): Cents | null {
  return parseScaledDecimal(text, CENTS_DECIMALS, MAX_AMOUNT_CENTS)
}

export function formatCents(cents: Cents, currency: Currency): string {
  return new Intl.NumberFormat('es-VE', { style: 'currency', currency }).format(cents / 100)
}

export function emptyAmounts(): AmountsByCurrency {
  return { USD: 0, VES: 0 }
}

export function addAmount(totals: AmountsByCurrency, currency: Currency, cents: Cents): AmountsByCurrency {
  return { ...totals, [currency]: totals[currency] + cents }
}
