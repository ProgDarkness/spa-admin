import { describe, expect, it } from 'vitest'
import { MAX_AMOUNT_CENTS } from '@/lib/money'
import { serviceFormSchema, serviceInputSchema } from './schemas'

const validInput = { name: 'Limpieza', priceCents: 3_500, durationMin: 60 }

function issueFields(result: { success: false; error: { issues: readonly { path: PropertyKey[] }[] } }): string[] {
  return result.error.issues.map((issue) => issue.path.map(String).join('.'))
}

describe('serviceInputSchema', () => {
  it('acepta un servicio válido y recorta el nombre', () => {
    const parsed = serviceInputSchema.safeParse({ ...validInput, name: '  Limpieza  ' })

    expect(parsed).toMatchObject({ success: true, data: validInput })
  })

  it.each([
    ['nombre vacío', { ...validInput, name: '' }, 'name'],
    ['nombre solo espacios', { ...validInput, name: '   ' }, 'name'],
    ['precio cero', { ...validInput, priceCents: 0 }, 'priceCents'],
    ['precio negativo', { ...validInput, priceCents: -1 }, 'priceCents'],
    ['precio decimal', { ...validInput, priceCents: 10.5 }, 'priceCents'],
    ['precio sobre el máximo', { ...validInput, priceCents: MAX_AMOUNT_CENTS + 1 }, 'priceCents'],
    ['duración cero', { ...validInput, durationMin: 0 }, 'durationMin'],
    ['duración negativa', { ...validInput, durationMin: -5 }, 'durationMin'],
    ['duración no múltiplo de 5', { ...validInput, durationMin: 12 }, 'durationMin'],
    ['duración decimal', { ...validInput, durationMin: 7.5 }, 'durationMin'],
    ['duración NaN', { ...validInput, durationMin: Number.NaN }, 'durationMin'],
  ])('rechaza %s señalando el campo', (_label, input, field) => {
    const parsed = serviceInputSchema.safeParse(input)

    expect(parsed.success).toBe(false)
    if (!parsed.success) expect(issueFields(parsed)).toContain(field)
  })

  it('acepta los límites: precio 1 y máximo, duración 5', () => {
    expect(serviceInputSchema.safeParse({ ...validInput, priceCents: 1, durationMin: 5 }).success).toBe(true)
    expect(serviceInputSchema.safeParse({ ...validInput, priceCents: MAX_AMOUNT_CENTS }).success).toBe(true)
  })

  it('rechaza tipos inválidos y nulos', () => {
    expect(serviceInputSchema.safeParse(null).success).toBe(false)
    expect(serviceInputSchema.safeParse({ ...validInput, priceCents: '10' }).success).toBe(false)
  })

  it('acepta nombres con Unicode y emojis', () => {
    expect(serviceInputSchema.safeParse({ ...validInput, name: 'Masaje relajante ✨ ñ' }).success).toBe(true)
  })
})

describe('serviceFormSchema', () => {
  const validForm = { name: ' Limpieza ', price: '35,50', durationMin: '60' }

  it('transforma strings a ServiceInput con centavos', () => {
    const parsed = serviceFormSchema.safeParse(validForm)

    expect(parsed).toMatchObject({ success: true, data: { name: 'Limpieza', priceCents: 3_550, durationMin: 60 } })
  })

  it('acepta punto decimal y enteros', () => {
    expect(serviceFormSchema.safeParse({ ...validForm, price: '12.5' })).toMatchObject({
      success: true,
      data: { priceCents: 1_250 },
    })
    expect(serviceFormSchema.safeParse({ ...validForm, price: '20' })).toMatchObject({
      success: true,
      data: { priceCents: 2_000 },
    })
  })

  it.each([
    ['nombre vacío', { ...validForm, name: '  ' }, 'name', 'Ingresa el nombre del servicio'],
    ['precio vacío', { ...validForm, price: '' }, 'price', 'Ingresa un precio válido'],
    ['precio con letras', { ...validForm, price: 'abc' }, 'price', 'Ingresa un precio válido'],
    ['precio cero', { ...validForm, price: '0' }, 'price', 'Ingresa un precio válido'],
    ['precio con tres decimales', { ...validForm, price: '1,234' }, 'price', 'Ingresa un precio válido'],
    ['duración vacía', { ...validForm, durationMin: '' }, 'durationMin', 'La duración debe ser un múltiplo de 5 minutos'],
    ['duración cero', { ...validForm, durationMin: '0' }, 'durationMin', 'La duración debe ser un múltiplo de 5 minutos'],
    ['duración 12', { ...validForm, durationMin: '12' }, 'durationMin', 'La duración debe ser un múltiplo de 5 minutos'],
    ['duración decimal', { ...validForm, durationMin: '7.5' }, 'durationMin', 'La duración debe ser un múltiplo de 5 minutos'],
  ])('rechaza %s', (_label, input, field, message) => {
    const parsed = serviceFormSchema.safeParse(input)

    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      const issue = parsed.error.issues.find((candidate) => candidate.path.join('.') === field)
      expect(issue?.message).toBe(message)
    }
  })

  it('reporta todos los campos inválidos a la vez', () => {
    const parsed = serviceFormSchema.safeParse({ name: '', price: '', durationMin: '' })

    expect(parsed.success).toBe(false)
    if (!parsed.success) expect(issueFields(parsed).sort()).toEqual(['durationMin', 'name', 'price'])
  })

  it('rechaza un precio sobre el máximo', () => {
    expect(serviceFormSchema.safeParse({ ...validForm, price: '99999999999' }).success).toBe(false)
  })
})

describe('límite del nombre del servicio', () => {
  const MAX_NAME_LENGTH = 80
  const MESSAGE = 'El nombre no puede superar 80 caracteres'
  const validForm = { name: 'Limpieza', price: '35,00', durationMin: '60' }

  it('acepta 80 caracteres en la entrada y el formulario', () => {
    const name = 'a'.repeat(MAX_NAME_LENGTH)

    expect(serviceInputSchema.safeParse({ ...validInput, name }).success).toBe(true)
    expect(serviceFormSchema.safeParse({ ...validForm, name }).success).toBe(true)
  })

  it('rechaza 81 caracteres con mensaje en español en la entrada y el formulario', () => {
    const name = 'a'.repeat(MAX_NAME_LENGTH + 1)

    const input = serviceInputSchema.safeParse({ ...validInput, name })
    const form = serviceFormSchema.safeParse({ ...validForm, name })

    expect(!input.success && input.error.issues[0]).toMatchObject({ path: ['name'], message: MESSAGE })
    expect(!form.success && form.error.issues[0]).toMatchObject({ path: ['name'], message: MESSAGE })
  })
})
