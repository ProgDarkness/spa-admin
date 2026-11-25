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

describe('nombre del recurso', () => {
  const MAX_NAME_LENGTH = 80
  const TOO_LONG = 'El nombre no puede superar 80 caracteres'
  const INVALID_CHARACTERS = 'El nombre contiene caracteres no permitidos'

  function nameOutcome(name: string) {
    return resourceInputSchema.safeParse({ name, kind: 'cabin' })
  }

  function nameIssue(name: string) {
    const parsed = nameOutcome(name)
    return parsed.success ? null : parsed.error.issues.find((issue) => issue.path.join('.') === 'name')
  }

  it('acepta nombres con Unicode, acentos y emojis', () => {
    expect(nameOutcome('Cabina ✨ ñ').success).toBe(true)
  })

  it('compone a NFC y colapsa los espacios ASCII', () => {
    expect(nameOutcome('Café  sala   dos')).toMatchObject({ success: true, data: { name: 'Café sala dos' } })
  })

  it.each([
    ['cero de ancho U+200B', 'Sa\u200Bla'],
    ['inversión bidi U+202E', 'Sa\u202Ela'],
    ['BOM interno U+FEFF', 'Sa\uFEFFla'],
    ['salto de línea', 'Sa\nla'],
    ['tabulación', 'Sa\tla'],
    ['separador de línea U+2028', 'Sa\u2028la'],
    ['espacio de no separación U+00A0', 'Sa\u00A0la'],
    ['etiqueta astral U+E0020', 'Sa\u{E0020}la'],
  ])('rechaza %s con mensaje en español', (_label, name) => {
    expect(nameIssue(name)?.message).toBe(INVALID_CHARACTERS)
  })

  it('rechaza un U+FEFF en el borde porque no es White_Space', () => {
    expect(nameIssue('\uFEFFSala')?.message).toBe(INVALID_CHARACTERS)
  })

  it('recorta U+0085 en el borde como Rust', () => {
    expect(nameOutcome('\u0085Sala\u0085')).toMatchObject({ success: true, data: { name: 'Sala' } })
  })

  it('rechaza un nombre vacío tras recortar con el mensaje existente', () => {
    expect(nameIssue(' \u0085 ')?.message).toBe('Ingresa el nombre del recurso')
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
    const decomposed = 'Cafe\u0301'.repeat(MAX_NAME_LENGTH / 4)

    expect([...decomposed].length).toBeGreaterThan(MAX_NAME_LENGTH)
    expect(nameOutcome(decomposed).success).toBe(true)
  })

  it('cuenta tras recortar y colapsar espacios', () => {
    expect(nameOutcome(`  ${'a'.repeat(39)}   ${'b'.repeat(40)}  `).success).toBe(true)
  })
})
