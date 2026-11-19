import { describe, expect, it } from 'vitest'
import { loginFormSchema, normalizeRecoveryCode, ownerSetupSchema, recoverySchema, unlockSchema } from './schemas'

const MIN_PASSWORD_MESSAGE = 'La contraseña debe tener al menos 10 caracteres'
const VALID_OWNER = { username: 'dueña', password: 'clave-larga-1', confirmPassword: 'clave-larga-1' }
const VALID_RECOVERY = {
  username: 'dueña',
  recoveryCode: 'ABCD-EFGH-IJKL-MNOP-QRST',
  newPassword: 'clave-larga-1',
  confirmPassword: 'clave-larga-1',
}

function messageOf(schema: { safeParse(input: unknown): { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } } }, field: string, input: unknown) {
  const result = schema.safeParse(input)
  return result.error?.issues.find((issue) => issue.path[0] === field)?.message
}

describe('ownerSetupSchema', () => {
  it('acepta datos válidos', () => {
    expect(ownerSetupSchema.safeParse(VALID_OWNER).success).toBe(true)
  })

  it('setup_password_min_10_error_text', () => {
    expect(messageOf(ownerSetupSchema, 'password', { ...VALID_OWNER, password: 'corta', confirmPassword: 'corta' })).toBe(
      MIN_PASSWORD_MESSAGE,
    )
  })

  it('cuenta code points y no unidades UTF-16', () => {
    const emojis = '😀'.repeat(10)

    expect(ownerSetupSchema.safeParse({ ...VALID_OWNER, password: emojis, confirmPassword: emojis }).success).toBe(true)
    expect(messageOf(ownerSetupSchema, 'password', { ...VALID_OWNER, password: '😀'.repeat(9), confirmPassword: '😀'.repeat(9) })).toBe(
      MIN_PASSWORD_MESSAGE,
    )
  })

  it('exige que la confirmación sea igual', () => {
    expect(messageOf(ownerSetupSchema, 'confirmPassword', { ...VALID_OWNER, confirmPassword: 'otra-clave-larga' })).toBe(
      'Las contraseñas no coinciden',
    )
  })

  it('exige el usuario', () => {
    expect(messageOf(ownerSetupSchema, 'username', { ...VALID_OWNER, username: '  ' })).toBe('Ingresa un usuario')
  })
})

describe('recoverySchema', () => {
  it('acepta el código con o sin guiones y en minúsculas', () => {
    expect(recoverySchema.safeParse(VALID_RECOVERY).success).toBe(true)
    expect(recoverySchema.safeParse({ ...VALID_RECOVERY, recoveryCode: 'abcdefghijklmnopqrst' }).success).toBe(true)
  })

  it.each(['', 'ABCD-EFGH', 'ABCD-EFGH-IJKL-MNOP-QRS1', 'ABCD-EFGH-IJKL-MNOP-QRSTU'])(
    'rechaza el código inválido %s',
    (recoveryCode) => {
      expect(messageOf(recoverySchema, 'recoveryCode', { ...VALID_RECOVERY, recoveryCode })).toBe(
        'El código de recuperación tiene 20 caracteres',
      )
    },
  )

  it('exige contraseña nueva de 10 caracteres y confirmación igual', () => {
    expect(messageOf(recoverySchema, 'newPassword', { ...VALID_RECOVERY, newPassword: 'corta' })).toBe(MIN_PASSWORD_MESSAGE)
    expect(messageOf(recoverySchema, 'confirmPassword', { ...VALID_RECOVERY, confirmPassword: 'x' })).toBe(
      'Las contraseñas no coinciden',
    )
  })

  it('normaliza el código a 20 caracteres en mayúsculas', () => {
    expect(normalizeRecoveryCode(' abcd-efgh ijkl-mnop-qrst ')).toBe('ABCDEFGHIJKLMNOPQRST')
  })
})

describe('unlockSchema', () => {
  it('exige la contraseña', () => {
    expect(unlockSchema.safeParse({ password: 'x' }).success).toBe(true)
    expect(messageOf(unlockSchema, 'password', { password: '' })).toBe('Ingresa tu contraseña')
  })
})

function firstMessageFor(field: string, input: unknown): string | undefined {
  const result = loginFormSchema.safeParse(input)
  if (result.success) return undefined
  return result.error.issues.find((issue) => issue.path[0] === field)?.message
}

describe('loginFormSchema', () => {
  it('acepta usuario y contraseña informados', () => {
    const result = loginFormSchema.safeParse({ username: 'propietaria', password: 'demo1234' })

    expect(result.success).toBe(true)
  })

  it('recorta espacios del usuario', () => {
    const result = loginFormSchema.safeParse({ username: '  propietaria  ', password: 'demo1234' })

    expect(result.success && result.data.username).toBe('propietaria')
  })

  it('no recorta la contraseña', () => {
    const result = loginFormSchema.safeParse({ username: 'propietaria', password: ' clave ' })

    expect(result.success && result.data.password).toBe(' clave ')
  })

  it('exige el usuario con mensaje en español', () => {
    expect(firstMessageFor('username', { username: '', password: 'x' })).toBe('Ingresa tu usuario')
  })

  it('trata un usuario solo con espacios como vacío', () => {
    expect(firstMessageFor('username', { username: '   ', password: 'x' })).toBe('Ingresa tu usuario')
  })

  it('exige la contraseña con mensaje en español', () => {
    expect(firstMessageFor('password', { username: 'u', password: '' })).toBe('Ingresa tu contraseña')
  })

  it('rechaza campos ausentes o de tipo inválido', () => {
    expect(loginFormSchema.safeParse({}).success).toBe(false)
    expect(loginFormSchema.safeParse({ username: 1, password: null }).success).toBe(false)
    expect(loginFormSchema.safeParse(undefined).success).toBe(false)
  })
})
