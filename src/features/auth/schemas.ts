import { z } from 'zod'
import type { LoginCredentials } from '@/lib/model'

export const loginFormSchema = z.object({
  username: z.string().trim().min(1, 'Ingresa tu usuario'),
  password: z.string().min(1, 'Ingresa tu contraseña'),
}) satisfies z.ZodType<LoginCredentials>
