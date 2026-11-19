import type { Cents, Currency } from '@/lib/model'
import { formatCents } from '@/lib/money'

const MINUTES_PER_HOUR = 60

export function formatMinutes(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / MINUTES_PER_HOUR)
  const minutes = totalMinutes % MINUTES_PER_HOUR
  if (hours === 0) return `${minutes} min`
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`
}

export function amountLine(label: string, cents: Cents, currency: Currency): string {
  return `${label}: ${formatCents(cents, currency)}`
}
