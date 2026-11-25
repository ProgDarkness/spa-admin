import { describe, expect, it } from 'vitest'
import { serviceFormSchema } from './schemas'

function issueFields(result: { success: false; error: { issues: readonly { path: PropertyKey[] }[] } }): string[] {
  return result.error.issues.map((issue) => issue.path.map(String).join('.'))
}

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

describe('nombre del servicio', () => {
  const MAX_NAME_LENGTH = 80
  const TOO_LONG = 'El nombre no puede superar 80 caracteres'
  const INVALID_CHARACTERS = 'El nombre contiene caracteres no permitidos'
  const form = { price: '35,00', durationMin: '60' }

  function nameOutcome(name: string) {
    return serviceFormSchema.safeParse({ ...form, name })
  }

  function nameIssue(name: string) {
    const parsed = nameOutcome(name)
    return parsed.success ? null : parsed.error.issues.find((issue) => issue.path.join('.') === 'name')
  }

  it('acepta nombres con Unicode, acentos y emojis', () => {
    expect(nameOutcome('Masaje relajante ✨ ñ').success).toBe(true)
    expect(nameOutcome('Limpieza facial con café').success).toBe(true)
  })

  it('compone a NFC y colapsa los espacios ASCII', () => {
    expect(nameOutcome('Café  con   leche')).toMatchObject({ success: true, data: { name: 'Café con leche' } })
  })

  it.each([
    ['cero de ancho U+200B', 'Sa​la'],
    ['inversión bidi U+202E', 'Sa‮la'],
    ['BOM interno U+FEFF', 'Sa﻿la'],
    ['salto de línea', 'Sa\nla'],
    ['tabulación', 'Sa\tla'],
    ['separador de línea U+2028', 'Sa la'],
    ['espacio de no separación U+00A0', 'Sa la'],
    ['etiqueta astral U+E0020', 'Sa\u{E0020}la'],
  ])('rechaza %s con mensaje en español', (_label, name) => {
    expect(nameIssue(name)?.message).toBe(INVALID_CHARACTERS)
  })

  it('rechaza un U+FEFF en el borde porque no es White_Space', () => {
    expect(nameIssue('﻿Sala')?.message).toBe(INVALID_CHARACTERS)
  })

  it('recorta U+0085 en el borde como Rust', () => {
    expect(nameOutcome('\u0085Sala\u0085')).toMatchObject({ success: true, data: { name: 'Sala' } })
  })

  it('rechaza un nombre vacío tras recortar con el mensaje existente', () => {
    expect(nameIssue(' \u0085 ')?.message).toBe('Ingresa el nombre del servicio')
  })

  it('acepta 80 code points y rechaza 81 aunque sean emojis de dos unidades UTF-16', () => {
    expect(nameOutcome('😀'.repeat(MAX_NAME_LENGTH)).success).toBe(true)
    expect(nameIssue('😀'.repeat(MAX_NAME_LENGTH + 1))?.message).toBe(TOO_LONG)
  })

  it('acepta 80 caracteres ASCII y rechaza 81 con mensaje en español', () => {
    expect(nameOutcome('a'.repeat(MAX_NAME_LENGTH)).success).toBe(true)
    expect(nameIssue('a'.repeat(MAX_NAME_LENGTH + 1))).toMatchObject({ path: ['name'], message: TOO_LONG })
  })

  it('cuenta tras NFC: 80 code points compuestos pero más de 80 descompuestos se aceptan', () => {
    const decomposed = 'Café'.repeat(MAX_NAME_LENGTH / 4)

    expect([...decomposed].length).toBeGreaterThan(MAX_NAME_LENGTH)
    expect(nameOutcome(decomposed).success).toBe(true)
  })

  it('cuenta tras recortar y colapsar espacios', () => {
    expect(nameOutcome(`  ${'a'.repeat(39)}   ${'b'.repeat(40)}  `).success).toBe(true)
  })
})
