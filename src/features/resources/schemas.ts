import { z } from 'zod'
import type { ResourceInput } from '@/lib/model'
import { recordNameSchema } from '@/lib/record-name-schema'

export const RESOURCE_KIND_LABELS = {
  cabin: 'Cabina',
  manicure: 'Manicure',
} as const

const NAME_MESSAGE = 'Ingresa el nombre del recurso'

const resourceNameSchema = recordNameSchema(NAME_MESSAGE)

export const resourceInputSchema = z.object({
  name: resourceNameSchema,
  kind: z.enum(['cabin', 'manicure']),
}) satisfies z.ZodType<ResourceInput>
