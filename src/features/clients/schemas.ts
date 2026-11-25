import { z } from 'zod'
import type { ClientInput } from '@/lib/model'
import { normalizeNationalId } from './national-id'

export const PHONE_PATTERN = /^\+?(?:[\s-]*\d){7,15}[\s-]*$/

const MAX_NAME_LENGTH = 80
const NATIONAL_ID_MESSAGE = 'Cédula inválida. Formato: V-12345678'

export const clientInputSchema = z.object({
  firstName: z.string().trim().min(1, 'Ingresa el nombre').max(MAX_NAME_LENGTH, `El nombre no puede superar ${MAX_NAME_LENGTH} caracteres`),
  lastName: z.string().trim().min(1, 'Ingresa el apellido').max(MAX_NAME_LENGTH, `El apellido no puede superar ${MAX_NAME_LENGTH} caracteres`),
  nationalId: z
    .string()
    .refine((raw) => normalizeNationalId(raw) !== null, NATIONAL_ID_MESSAGE)
    .transform((raw) => normalizeNationalId(raw) ?? raw),
  phone: z.string().trim().regex(PHONE_PATTERN, 'Teléfono inválido. Usa de 7 a 15 dígitos'),
}) satisfies z.ZodType<ClientInput>
