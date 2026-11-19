import { z } from 'zod'
import type { LoginCredentials } from '@/lib/model'

export const MIN_NEW_PASSWORD_CHARS = 10
const RECOVERY_CODE_PATTERN = /^[A-Z2-7]{20}$/

export const PASSWORD_TOO_SHORT_MESSAGE = `La contraseña debe tener al menos ${MIN_NEW_PASSWORD_CHARS} caracteres`
const PASSWORD_MISMATCH_MESSAGE = 'Las contraseñas no coinciden'
const RECOVERY_CODE_MESSAGE = 'El código de recuperación tiene 20 caracteres'

export const loginFormSchema = z.object({
  username: z.string().trim().min(1, 'Ingresa tu usuario'),
  password: z.string().min(1, 'Ingresa tu contraseña'),
}) satisfies z.ZodType<LoginCredentials>

export const unlockSchema = z.object({
  password: z.string().min(1, 'Ingresa tu contraseña'),
})

export type UnlockInput = z.infer<typeof unlockSchema>

export function normalizeRecoveryCode(typed: string): string {
  return typed.replace(/[\s-]/g, '').toUpperCase()
}

const newPasswordField = z
  .string()
  .refine((value) => [...value].length >= MIN_NEW_PASSWORD_CHARS, PASSWORD_TOO_SHORT_MESSAGE)

export const ownerSetupSchema = z
  .object({
    username: z.string().trim().min(1, 'Ingresa un usuario'),
    password: newPasswordField,
    confirmPassword: z.string(),
  })
  .refine((value) => value.password === value.confirmPassword, {
    path: ['confirmPassword'],
    message: PASSWORD_MISMATCH_MESSAGE,
  })

export type OwnerSetupInput = z.infer<typeof ownerSetupSchema>

export const recoverySchema = z
  .object({
    username: z.string().trim().min(1, 'Ingresa tu usuario'),
    recoveryCode: z.string().refine((value) => RECOVERY_CODE_PATTERN.test(normalizeRecoveryCode(value)), RECOVERY_CODE_MESSAGE),
    newPassword: newPasswordField,
    confirmPassword: z.string(),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    path: ['confirmPassword'],
    message: PASSWORD_MISMATCH_MESSAGE,
  })

export type RecoveryInput = z.infer<typeof recoverySchema>
