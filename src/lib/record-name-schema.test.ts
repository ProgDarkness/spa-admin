import { describe, expect, it } from 'vitest'
import { recordNameSchema } from './record-name-schema'

const EMPTY_MESSAGE = 'Ingresa el nombre'
const TOO_LONG = 'El nombre no puede superar 80 caracteres'
const INVALID_CHARACTERS = 'El nombre contiene caracteres no permitidos'
const schema = recordNameSchema(EMPTY_MESSAGE)

function messageOf(name: unknown): string | undefined {
  const parsed = schema.safeParse(name)
  return parsed.success ? undefined : parsed.error.issues[0]?.message
}

describe('recordNameSchema', () => {
  it('compone a NFC, recorta y colapsa espacios ASCII', () => {
    expect(schema.parse('  Café   sala  ')).toBe('Café sala')
  })

  it.each(['', '   ', ' \u0085 '])('rechaza el vacío %j con el mensaje recibido', (name) => {
    expect(messageOf(name)).toBe(EMPTY_MESSAGE)
  })

  it('acepta 80 code points y rechaza 81 aunque sean emojis', () => {
    expect(schema.safeParse('😀'.repeat(80)).success).toBe(true)
    expect(messageOf('😀'.repeat(81))).toBe(TOO_LONG)
  })

  it.each(['Sa​la', 'Sa\tla', 'Sa la', '﻿Sala'])('rechaza caracteres no permitidos %j', (name) => {
    expect(messageOf(name)).toBe(INVALID_CHARACTERS)
  })

  it('rechaza tipos que no son texto', () => {
    expect(schema.safeParse(5).success).toBe(false)
    expect(schema.safeParse(null).success).toBe(false)
  })
})
