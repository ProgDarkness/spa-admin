import { describe, expect, it } from 'vitest'
import type { ClientInput } from '@/lib/model'
import { clientInputSchema } from './schemas'

const VALID_INPUT: ClientInput = {
  firstName: 'María',
  lastName: 'González',
  nationalId: 'V-12345678',
  phone: '0414-1234567',
}

function issueFieldsOf(input: unknown): string[] {
  const parsed = clientInputSchema.safeParse(input)
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join('.'))
}

describe('clientInputSchema', () => {
  it('acepta un cliente válido', () => {
    expect(clientInputSchema.parse(VALID_INPUT)).toEqual(VALID_INPUT)
  })

  it.each(['V-12345678', 'E-81234567', 'J-123456', 'J-123456789'])('acepta la cédula %s', (nationalId) => {
    expect(issueFieldsOf({ ...VALID_INPUT, nationalId })).toEqual([])
  })

  it.each([
    ['v12345678', 'V-12345678'],
    ['v 12345678', 'V-12345678'],
    ['V-12.345.678', 'V-12345678'],
    ['v-12345678', 'V-12345678'],
    [' e-81.234.567 ', 'E-81234567'],
  ])('normaliza la cédula %j a %j como Rust', (typed, normalized) => {
    expect(clientInputSchema.parse({ ...VALID_INPUT, nationalId: typed }).nationalId).toBe(normalized)
  })

  it.each(['X-1', 'V-12345', 'V-1234567890', 'V-12a45678', 'V--12-34-56-78', 'V-1.2345.678', '', ' '])(
    'rechaza la cédula "%s"',
    (nationalId) => {
      expect(issueFieldsOf({ ...VALID_INPUT, nationalId })).toEqual(['nationalId'])
    },
  )

  it('recorta espacios alrededor de todos los campos', () => {
    const parsed = clientInputSchema.parse({
      firstName: '  Ana ',
      lastName: ' Pérez  ',
      nationalId: ' V-16789012 ',
      phone: ' 0412-3456789 ',
    })

    expect(parsed).toEqual({ firstName: 'Ana', lastName: 'Pérez', nationalId: 'V-16789012', phone: '0412-3456789' })
  })

  it.each(['firstName', 'lastName'] as const)('rechaza %s vacío o solo espacios', (field) => {
    expect(issueFieldsOf({ ...VALID_INPUT, [field]: '' })).toEqual([field])
    expect(issueFieldsOf({ ...VALID_INPUT, [field]: '   ' })).toEqual([field])
  })

  it.each(['0414-1234567', '+58 414 1234567', '0212 555 1234', '5551234'])('acepta el teléfono %s', (phone) => {
    expect(issueFieldsOf({ ...VALID_INPUT, phone })).toEqual([])
  })

  it.each(['', '   ', 'abc', '123', '0414-12a4567', '(0414)1234567', '+', '1234567890123456'])(
    'rechaza el teléfono "%s"',
    (phone) => {
      expect(issueFieldsOf({ ...VALID_INPUT, phone })).toEqual(['phone'])
    },
  )

  it('rechaza campos ausentes y tipos inválidos', () => {
    expect(issueFieldsOf({})).toEqual(expect.arrayContaining(['firstName', 'lastName', 'nationalId', 'phone']))
    expect(issueFieldsOf({ ...VALID_INPUT, phone: 4141234567 })).toEqual(['phone'])
    expect(issueFieldsOf(null)).toEqual([''])
    expect(issueFieldsOf(undefined)).toEqual([''])
  })

  it('no muta el objeto de entrada', () => {
    const input = { ...VALID_INPUT, firstName: '  Ana ' }

    clientInputSchema.parse(input)

    expect(input.firstName).toBe('  Ana ')
  })
})

describe('límites de nombre y apellido', () => {
  const MAX_NAME_LENGTH = 80

  it.each([
    ['firstName', 'El nombre no puede superar 80 caracteres'],
    ['lastName', 'El apellido no puede superar 80 caracteres'],
  ] as const)('%s acepta 80 caracteres y rechaza 81 con mensaje en español', (field, message) => {
    expect(issueFieldsOf({ ...VALID_INPUT, [field]: 'a'.repeat(MAX_NAME_LENGTH) })).toEqual([])

    const rejected = clientInputSchema.safeParse({ ...VALID_INPUT, [field]: 'a'.repeat(MAX_NAME_LENGTH + 1) })

    expect(!rejected.success && rejected.error.issues[0]).toMatchObject({ path: [field], message })
  })
})
