import { z } from 'zod'
import { isExistingDate } from '@/lib/datetime'
import type { ExchangeRate } from '@/lib/model'
import { MAX_RATE_E4, parseRateE4 } from '@/lib/money'

const INVALID_DATE_MESSAGE = 'Ingresa una fecha válida'

const dateSchema = z.string().refine(isExistingDate, INVALID_DATE_MESSAGE)

export const rateInputSchema = z.object({
  date: dateSchema,
  rateBsPerUsdE4: z
    .number()
    .int('La tasa debe ser un entero')
    .min(1, 'La tasa debe ser mayor que cero')
    .max(MAX_RATE_E4, 'La tasa excede el máximo permitido'),
}) satisfies z.ZodType<ExchangeRate>

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
