import { z } from 'zod'
import type { ResourceInput } from '@/lib/model'
import { countCodePoints, hasDisallowedTextCharacter, normalizeDisplayText } from '@/lib/text'

export const RESOURCE_KIND_LABELS = {
  cabin: 'Cabina',
  manicure: 'Manicure',
} as const

const MAX_NAME_LENGTH = 80
const NAME_MESSAGE = 'Ingresa el nombre del recurso'
const NAME_TOO_LONG_MESSAGE = `El nombre no puede superar ${MAX_NAME_LENGTH} caracteres`
const NAME_INVALID_CHARACTERS_MESSAGE = 'El nombre contiene caracteres no permitidos'

const resourceNameSchema = z
  .string()
  .transform(normalizeDisplayText)
  .pipe(
    z
      .string()
      .min(1, NAME_MESSAGE)
      .refine((name) => countCodePoints(name) <= MAX_NAME_LENGTH, NAME_TOO_LONG_MESSAGE)
      .refine((name) => !hasDisallowedTextCharacter(name), NAME_INVALID_CHARACTERS_MESSAGE),
  )

export const resourceInputSchema = z.object({
  name: resourceNameSchema,
  kind: z.enum(['cabin', 'manicure']),
}) satisfies z.ZodType<ResourceInput>
