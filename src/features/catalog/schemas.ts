import { z } from 'zod'
import type { ServiceInput } from '@/lib/model'
import { parseCents } from '@/lib/money'
import { countCodePoints, hasDisallowedTextCharacter, normalizeDisplayText } from '@/lib/text'

const DURATION_STEP_MIN = 5
const PRICE_MESSAGE = 'Ingresa un precio válido'
const DURATION_MESSAGE = 'La duración debe ser un múltiplo de 5 minutos'
const MAX_NAME_LENGTH = 80
const NAME_MESSAGE = 'Ingresa el nombre del servicio'
const NAME_TOO_LONG_MESSAGE = `El nombre no puede superar ${MAX_NAME_LENGTH} caracteres`
const NAME_INVALID_CHARACTERS_MESSAGE = 'El nombre contiene caracteres no permitidos'
const WHOLE_NUMBER_PATTERN = /^\d+$/

function isValidDurationMin(value: number): boolean {
  return Number.isInteger(value) && value > 0 && value % DURATION_STEP_MIN === 0
}

const serviceNameSchema = z
  .string()
  .transform(normalizeDisplayText)
  .pipe(
    z
      .string()
      .min(1, NAME_MESSAGE)
      .refine((name) => countCodePoints(name) <= MAX_NAME_LENGTH, NAME_TOO_LONG_MESSAGE)
      .refine((name) => !hasDisallowedTextCharacter(name), NAME_INVALID_CHARACTERS_MESSAGE),
  )

export type ServiceFormValues = { name: string; price: string; durationMin: string }

const priceTextSchema = z.string().transform((text, context) => {
  const cents = parseCents(text)
  if (cents !== null && cents > 0) return cents
  context.issues.push({ code: 'custom', message: PRICE_MESSAGE, input: text })
  return z.NEVER
})

const durationTextSchema = z.string().transform((text, context) => {
  const trimmed = text.trim()
  const minutes = WHOLE_NUMBER_PATTERN.test(trimmed) ? Number(trimmed) : Number.NaN
  if (isValidDurationMin(minutes)) return minutes
  context.issues.push({ code: 'custom', message: DURATION_MESSAGE, input: text })
  return z.NEVER
})

export const serviceFormSchema = z
  .object({
    name: serviceNameSchema,
    price: priceTextSchema,
    durationMin: durationTextSchema,
  })
  .transform(({ name, price, durationMin }): ServiceInput => ({ name, priceCents: price, durationMin })) satisfies z.ZodType<
  ServiceInput,
  ServiceFormValues
>
