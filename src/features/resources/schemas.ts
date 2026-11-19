import { z } from 'zod'
import type { ResourceInput } from '@/lib/model'

export const RESOURCE_KIND_LABELS = {
  cabin: 'Cabina',
  manicure: 'Manicure',
} as const

const MAX_NAME_LENGTH = 60

export const resourceInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Ingresa el nombre del recurso')
    .max(MAX_NAME_LENGTH, `El nombre no puede superar ${MAX_NAME_LENGTH} caracteres`),
  kind: z.enum(['cabin', 'manicure']),
}) satisfies z.ZodType<ResourceInput>
