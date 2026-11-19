import { z } from 'zod'
import type { Currency, PaymentInput } from '@/lib/model'
import { MAX_AMOUNT_CENTS, MAX_RATE_E4, parseCents, parseRateE4 } from '@/lib/money'

const MAX_REASON_LENGTH = 200
const METHOD_MESSAGE = 'Selecciona un método de pago'
const AMOUNT_MESSAGE = 'Ingresa un monto mayor que cero con hasta 2 decimales'
const RATE_MESSAGE = 'Ingresa una tasa mayor que cero con hasta 4 decimales'
const REASON_MESSAGE = 'Indica el motivo de la anulación'
const WHOLE_NUMBER_PATTERN = /^\d+$/

const currencySchema = z.enum(['USD', 'VES'], { error: 'Selecciona la moneda' })

const identifierSchema = z.number().int('Identificador inválido').min(1, 'Identificador inválido')

export const paymentInputSchema = z.object({
  appointmentId: identifierSchema,
  methodId: identifierSchema,
  currency: currencySchema,
  amountCents: z
    .number()
    .int('El monto debe ser un entero de céntimos')
    .min(1, 'El monto debe ser mayor que cero')
    .max(MAX_AMOUNT_CENTS, 'El monto excede el máximo permitido'),
  rateBsPerUsdE4: z
    .number()
    .int('La tasa debe ser un entero')
    .min(1, 'La tasa debe ser mayor que cero')
    .max(MAX_RATE_E4, 'La tasa excede el máximo permitido')
    .nullable(),
}) satisfies z.ZodType<PaymentInput>

export const voidReasonSchema = z.string().trim().min(1, REASON_MESSAGE).max(MAX_REASON_LENGTH, 'El motivo es demasiado largo')

export const voidFormSchema = z.object({ reason: voidReasonSchema })

export type VoidFormValues = z.input<typeof voidFormSchema>

export type PaymentFormValues = { methodId: string; currency: Currency; amount: string; rate: string }

export type PaymentFormData = Omit<PaymentInput, 'appointmentId'>

type RateOutcome = { rate: number | null; failed: boolean }

function rateOf(currency: Currency, rateText: string): RateOutcome {
  const trimmed = rateText.trim()
  if (currency === 'USD' || trimmed === '') return { rate: null, failed: false }
  const parsed = parseRateE4(trimmed)
  return { rate: parsed, failed: parsed === null }
}

export const paymentFormSchema = z
  .object({
    methodId: z.string(),
    currency: currencySchema,
    amount: z.string(),
    rate: z.string(),
  })
  .transform((values, context): PaymentFormData => {
    const methodText = values.methodId.trim()
    const methodId = WHOLE_NUMBER_PATTERN.test(methodText) ? Number(methodText) : 0
    const amountCents = parseCents(values.amount)
    const { rate, failed: rateFailed } = rateOf(values.currency, values.rate)
    const rejections: { path: string; message: string }[] = [
      ...(methodId < 1 ? [{ path: 'methodId', message: METHOD_MESSAGE }] : []),
      ...(amountCents === null || amountCents < 1 ? [{ path: 'amount', message: AMOUNT_MESSAGE }] : []),
      ...(rateFailed ? [{ path: 'rate', message: RATE_MESSAGE }] : []),
    ]
    rejections.forEach(({ path, message }) =>
      context.issues.push({ code: 'custom', message, input: values, path: [path] }),
    )
    if (rejections.length > 0) return z.NEVER
    return { methodId, currency: values.currency, amountCents: amountCents ?? 0, rateBsPerUsdE4: rate }
  }) satisfies z.ZodType<PaymentFormData, PaymentFormValues>
