import { describe, expect, it } from 'vitest'
import { resourceInputSchema } from './schemas'

describe('resourceInputSchema', () => {
  it.each(['cabin', 'manicure'] as const)('acepta kind %s', (kind) => {
    const result = resourceInputSchema.safeParse({ name: 'Cabina 9', kind })

    expect(result.success).toBe(true)
  })

  it('recorta espacios del nombre', () => {
    const result = resourceInputSchema.safeParse({ name: '  Cabina 9  ', kind: 'cabin' })

    expect(result.success && result.data.name).toBe('Cabina 9')
  })

  it.each(['', '   '])('rechaza el nombre vacío %j con mensaje en español', (name) => {
    const result = resourceInputSchema.safeParse({ name, kind: 'cabin' })

    expect(result.success).toBe(false)
    expect(!result.success && result.error.issues[0]?.message).toBe('Ingresa el nombre del recurso')
    expect(!result.success && result.error.issues[0]?.path).toEqual(['name'])
  })

  it('rechaza un kind desconocido', () => {
    const result = resourceInputSchema.safeParse({ name: 'Sala', kind: 'sauna' })

    expect(result.success).toBe(false)
    expect(!result.success && result.error.issues[0]?.path).toEqual(['kind'])
  })

  it('rechaza campos faltantes y tipos inválidos', () => {
    expect(resourceInputSchema.safeParse({}).success).toBe(false)
    expect(resourceInputSchema.safeParse({ name: 5, kind: 'cabin' }).success).toBe(false)
    expect(resourceInputSchema.safeParse(null).success).toBe(false)
  })
})

describe('límite del nombre del recurso', () => {
  const MAX_NAME_LENGTH = 60

  it('acepta 60 caracteres', () => {
    const result = resourceInputSchema.safeParse({ name: 'a'.repeat(MAX_NAME_LENGTH), kind: 'cabin' })

    expect(result.success).toBe(true)
  })

  it('rechaza 61 caracteres con mensaje en español', () => {
    const result = resourceInputSchema.safeParse({ name: 'a'.repeat(MAX_NAME_LENGTH + 1), kind: 'cabin' })

    expect(!result.success && result.error.issues[0]).toMatchObject({
      path: ['name'],
      message: 'El nombre no puede superar 60 caracteres',
    })
  })
})
