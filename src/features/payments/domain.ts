import type { AmountsByCurrency, Cents, Payment, RateE4 } from '@/lib/model'
import { addAmount, emptyAmounts, RATE_SCALE } from '@/lib/money'

export function isActivePayment(payment: Payment): boolean {
  return payment.voidedAt === null
}

export function sumActivePayments(payments: readonly Payment[]): AmountsByCurrency {
  return payments
    .filter(isActivePayment)
    .reduce((totals, payment) => addAmount(totals, payment.currency, payment.amountCents), emptyAmounts())
}

export function usdTotalOfActivePayments(payments: readonly Payment[]): Cents {
  return payments.filter(isActivePayment).reduce((total, payment) => total + payment.usdEquivalentCents, 0)
}

const RATE_TEXT_DECIMALS = 4
const RATE_TRAILING_ZEROS = /(?<=\.\d\d\d?)0+$/

export function rateInputText(rate: RateE4): string {
  return (rate / RATE_SCALE).toFixed(RATE_TEXT_DECIMALS).replace(RATE_TRAILING_ZEROS, '').replace('.', ',')
}
