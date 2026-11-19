import { z } from 'zod'
import { YEAR_MONTH_PATTERN } from '@/lib/datetime'

const MONTH_MESSAGE = 'Ingresa un mes válido (AAAA-MM)'
const FIRST_MONTH = 1
const LAST_MONTH = 12
const MONTH_NUMBER_START = 5

function hasValidMonthNumber(yearMonth: string): boolean {
  const monthNumber = Number(yearMonth.slice(MONTH_NUMBER_START))
  return monthNumber >= FIRST_MONTH && monthNumber <= LAST_MONTH
}

export const monthInputSchema = z.object({
  month: z.string().regex(YEAR_MONTH_PATTERN, MONTH_MESSAGE).refine(hasValidMonthNumber, MONTH_MESSAGE),
})
