import { describe, expect, it } from 'vitest'
import { loginFormSchema } from './schemas'

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
