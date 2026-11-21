import { z } from 'zod'
import { isExistingDate } from '@/lib/datetime'
import type { ExchangeRate } from '@/lib/model'
import { parseRateE4 } from '@/lib/money'

const INVALID_DATE_MESSAGE = 'Ingresa una fecha válida'

const FIRST_RATE_YEAR = 2000
const LAST_RATE_YEAR = 2099
const YEAR_LENGTH = 4

export function isSupportedRateDate(date: string): boolean {
  const year = Number(date.slice(0, YEAR_LENGTH))
  return isExistingDate(date) && year >= FIRST_RATE_YEAR && year <= LAST_RATE_YEAR
}

const dateSchema = z.string().refine(isSupportedRateDate, INVALID_DATE_MESSAGE)

const INVALID_RATE_TEXT_MESSAGE = 'Ingresa una tasa mayor que cero con hasta 4 decimales'

const rateTextSchema = z.string().transform((text, context) => {
  const parsed = parseRateE4(text)
  if (parsed === null) {
    context.addIssue({ code: 'custom', message: INVALID_RATE_TEXT_MESSAGE })
    return z.NEVER
  }
  return parsed
})

export const rateFormFieldsSchema = z.object({
  date: dateSchema,
  rateText: z.string().refine((text) => parseRateE4(text) !== null, INVALID_RATE_TEXT_MESSAGE),
})

export const rateFormSchema = z
  .object({ date: dateSchema, rateText: rateTextSchema })
  .transform(({ date, rateText }) => ({ date, rateBsPerUsdE4: rateText })) satisfies z.ZodType<
  ExchangeRate,
  { date: string; rateText: string }
>

export type RateFormValues = z.infer<typeof rateFormFieldsSchema>
