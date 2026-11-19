import { z } from 'zod'
import type { ClientInput } from '@/lib/model'

export const NATIONAL_ID_PATTERN = /^[VEJ]-\d{6,9}$/
export const PHONE_PATTERN = /^\+?(?:[\s-]*\d){7,15}[\s-]*$/

const MAX_NAME_LENGTH = 80

export const clientInputSchema = z.object({
  firstName: z.string().trim().min(1, 'Ingresa el nombre').max(MAX_NAME_LENGTH, `El nombre no puede superar ${MAX_NAME_LENGTH} caracteres`),
  lastName: z.string().trim().min(1, 'Ingresa el apellido').max(MAX_NAME_LENGTH, `El apellido no puede superar ${MAX_NAME_LENGTH} caracteres`),
  nationalId: z.string().trim().regex(NATIONAL_ID_PATTERN, 'Cédula inválida. Formato: V-12345678'),
  phone: z.string().trim().regex(PHONE_PATTERN, 'Teléfono inválido. Usa de 7 a 15 dígitos'),
}) satisfies z.ZodType<ClientInput>
